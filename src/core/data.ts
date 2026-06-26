import { execa } from "execa";
import { existsSync, statSync } from "node:fs";
import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import type { ProjectManifest } from "../manifest/types.js";
import { envFileVars, configEnv, interpolateEnv } from "./env.js";
import { premoHome } from "./home.js";
import { withFileLock } from "./lockfile.js";
import { mainWorktree } from "./git.js";
import { sanitizeProjectName } from "./project.js";

// The data axis (DATA-DIRECTORIES.md). premo owns an opaque handle per isolated
// data instance + the registry; the repo owns the physical state, addressed by
// the handle. Either wired lifecycle scripts (Contract A) or the built-in
// directory adapter (Contract B, `data.dir`) realize an instance.
//
// Both the registry and the directory adapter's instance dirs live in premo's
// host-global home, keyed by the project's MAIN worktree — *not* the current
// checkout. So a handle minted in one worktree is visible (`list`/`delete`) and
// clonable from every other worktree of the same repo, and instances survive a
// worktree teardown. (Ports are deliberately the opposite — per-worktree — so the
// two don't share a key.)

// A tracked data instance (DATA-DIRECTORIES.md §3.4). premo owns this registry;
// the `handle` is the only public reference. `from` records the source handle a
// clone was made from (or `live`). Every instance persists until `delete` — premo
// has no lifecycle/reaping policy of its own. `ref` is an optional opaque descriptor
// a non-deterministic substrate's `create` script may emit on stdout for premo to
// replay (reserved; see §3.3) — the directory adapter derives its path from the
// handle and never sets it.
//
// `path` is set only by `link` (directory adapter): the handle points at an
// existing absolute directory premo does NOT own, instead of a home-derived one.
// premo never creates or deletes that directory — `delete` only de-registers it.
export interface DataInstance {
  handle: string;
  name?: string;
  from?: string | null;
  createdAt: string;
  ref?: string;
  path?: string;
}

export interface DataState {
  instances: DataInstance[];
}

// The reserved source name for "the project's live working data" (`data.dir`),
// so a golden dataset can be bootstrapped straight from a hand-curated one:
//   premo data clone live --name golden
export const LIVE = "live";

export class DataError extends Error {}

// --- the global data home (keyed by the main worktree) -----------------------

// A repo's cross-worktree identity: the main worktree's absolute path, the same
// from any linked worktree. Outside a git repo, fall back to the checkout path
// (a non-git project is its own single "worktree").
async function projectKey(root: string): Promise<string> {
  const main = await mainWorktree(root);
  return path.resolve(main ?? root);
}

// A human-browsable, collision-resistant directory name for the project: the main
// worktree's basename + a short hash of its full path (two repos named `app` in
// different parents get distinct homes).
function projectSlug(key: string): string {
  const base = sanitizeProjectName(path.basename(key)) || "project";
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

// `$PREMO_HOME/data/<slug>/` — the registry (`registry.json`) and the directory
// adapter's per-handle instance dirs both live here, shared across worktrees.
export async function dataHome(root: string): Promise<string> {
  return path.join(premoHome(), "data", projectSlug(await projectKey(root)));
}

function instanceDirAt(home: string, handle: string): string {
  return path.join(home, handle);
}

// The on-disk dir an instance resolves to: a `link`ed instance's custom absolute
// path, else the home-derived dir for this handle. Use this everywhere a tracked
// instance's directory is needed, so linked instances are transparent.
function resolvedDir(home: string, inst: DataInstance): string {
  return inst.path ?? instanceDirAt(home, inst.handle);
}

// The on-disk directory for a directory-adapter instance. Async because it
// resolves the project's global home first.
export async function instanceDir(root: string, handle: string): Promise<string> {
  return instanceDirAt(await dataHome(root), handle);
}

function registryFile(home: string): string {
  return path.join(home, "registry.json");
}

async function loadData(home: string): Promise<DataState> {
  const file = registryFile(home);
  if (!existsSync(file)) return { instances: [] };
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<DataState>;
    return { instances: raw.instances ?? [] };
  } catch {
    return { instances: [] };
  }
}

async function saveData(home: string, data: DataState): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(registryFile(home), JSON.stringify(data, null, 2) + "\n", "utf8");
}

// The registry is shared across a repo's worktrees, so two `premo data` calls from
// two worktrees would otherwise race the load→mutate→save. Hold the lock only for
// that fast critical section — never across the slow copy/script (see lockfile.ts).
function withLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(path.join(home, "registry.lock"), fn);
}

export function findInstance(data: DataState, handle: string): DataInstance | undefined {
  return data.instances.find((i) => i.handle === handle);
}

// --- minting, deleting, listing ----------------------------------------------

type Action = "create" | "clone" | "delete";

function mintHandle(existing: Set<string>): string {
  for (;;) {
    const handle = "d_" + randomBytes(4).toString("hex").slice(0, 6);
    if (!existing.has(handle)) return handle;
  }
}

// Whether this project can do `action` at all: a wired script for it, or the
// directory adapter (`dir`) which supplies create/clone/delete in-process.
function supports(manifest: ProjectManifest, action: Action): boolean {
  const data = manifest.data;
  if (!data) return false;
  return data[action] !== undefined || data.dir !== undefined;
}

// Copy a directory tree, preferring copy-on-write so cloning a large reference is
// near-instant (APFS clonefile via `cp -c`; reflink on Linux), falling back to a
// plain recursive copy on filesystems that don't support it.
async function copyTree(src: string, dst: string): Promise<void> {
  await mkdir(path.dirname(dst), { recursive: true });
  const args =
    process.platform === "darwin" ? ["-Rc", src, dst] : ["-R", "--reflink=auto", src, dst];
  try {
    await execa("cp", args);
  } catch {
    await cp(src, dst, { recursive: true });
  }
}

// Run a wired data script: cwd = root, the normal env layering (envFile + project
// `env`), plus premo's injected PREMO_DATA_* vars. The script's stdout is routed to
// our stderr so a `--json` result stays the only thing on stdout.
async function runScript(
  root: string,
  manifest: ProjectManifest,
  command: string,
  injected: Record<string, string>,
): Promise<void> {
  const fileVars = await envFileVars(root, manifest.envFile ?? undefined);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...configEnv(fileVars, manifest.env, undefined),
    ...injected,
  };
  await execa(command, {
    cwd: root,
    env,
    shell: true,
    stdin: "inherit",
    stdout: process.stderr,
    stderr: "inherit",
  });
}

// Resolve a source name (a handle, or the reserved `live`) to its handle label and
// — for the directory adapter — its on-disk path. `live` is the *current*
// checkout's working data (root-relative); a handle resolves into the global home.
function resolveSource(
  root: string,
  home: string,
  manifest: ProjectManifest,
  data: DataState,
  from: string,
): { fromLabel: string; fromPath: string | undefined } {
  if (from === LIVE) {
    const dir = manifest.data?.dir;
    if (!dir) throw new DataError(`source "${LIVE}" needs a directory adapter (set data.dir)`);
    return { fromLabel: LIVE, fromPath: path.join(root, dir) };
  }
  const inst = findInstance(data, from);
  if (!inst) throw new DataError(`unknown source handle "${from}"`);
  return { fromLabel: from, fromPath: resolvedDir(home, inst) };
}

export interface MintOpts {
  name?: string;
  from?: string; // a handle or `live`; absent ⇒ a fresh instance
}

// Create or clone — a fresh instance, or a copy of an existing one (or of `live`).
// Runs the wired script if present, else the directory-adapter built-in, then
// records the new instance. Every instance persists until `delete`. Returns it.
export async function mintInstance(
  root: string,
  manifest: ProjectManifest,
  opts: MintOpts,
): Promise<DataInstance> {
  const data = manifest.data;
  if (!data) throw new DataError("no `data` wired for this project");
  const action: Action = opts.from ? "clone" : "create";
  if (!supports(manifest, action))
    throw new DataError(`\`${action}\` is not wired (add a \`${action}\` command or \`dir\`)`);

  const home = await dataHome(root);
  const state = await loadData(home);
  // Handles are random, so this set is just a cosmetic uniqueness guard; the
  // authoritative append happens under the lock below.
  const handle = mintHandle(new Set(state.instances.map((i) => i.handle)));

  let fromLabel: string | null = null;
  let fromPath: string | undefined;
  if (opts.from) {
    const src = resolveSource(root, home, manifest, state, opts.from);
    fromLabel = src.fromLabel;
    fromPath = src.fromPath;
  }

  // The slow part (script / CoW copy) runs WITHOUT the registry lock so a big
  // clone never trips the lock's staleness timeout for a concurrent worktree.
  const wired = data[action];
  if (wired) {
    const injected: Record<string, string> = { PREMO_DATA_HANDLE: handle };
    if (data.dir) injected.PREMO_DATA_DIR = instanceDirAt(home, handle);
    if (fromLabel) injected.PREMO_DATA_FROM = fromLabel;
    if (fromPath && data.dir) injected.PREMO_DATA_FROM_DIR = fromPath;
    await runScript(root, manifest, wired, injected);
  } else {
    // Directory adapter built-in.
    const dst = instanceDirAt(home, handle);
    if (fromPath) {
      if (!existsSync(fromPath)) throw new DataError(`source has no data at ${fromPath}`);
      await copyTree(fromPath, dst);
    } else {
      await mkdir(dst, { recursive: true });
    }
  }

  const instance: DataInstance = {
    handle,
    ...(opts.name ? { name: opts.name } : {}),
    from: fromLabel,
    createdAt: new Date().toISOString(),
  };
  await withLock(home, async () => {
    const fresh = await loadData(home);
    fresh.instances.push(instance);
    await saveData(home, fresh);
  });
  return instance;
}

// Register a handle that points at an EXISTING directory (directory adapter only),
// instead of one premo creates under its home. `target` may be relative — it's
// resolved against the cwd to an absolute path and stored. premo doesn't own the
// directory: it's never copied here, and `delete` only de-registers it. Returns
// the new instance.
export async function linkInstance(
  root: string,
  manifest: ProjectManifest,
  target: string,
  opts: { name?: string } = {},
): Promise<DataInstance> {
  const data = manifest.data;
  if (!data) throw new DataError("no `data` wired for this project");
  if (!data.dir) throw new DataError("`link` needs the directory adapter (set `data.dir`)");

  const abs = path.resolve(target);
  if (!existsSync(abs)) throw new DataError(`no directory at ${abs}`);
  if (!statSync(abs).isDirectory()) throw new DataError(`not a directory: ${abs}`);

  const home = await dataHome(root);
  const state = await loadData(home);
  const handle = mintHandle(new Set(state.instances.map((i) => i.handle)));

  const instance: DataInstance = {
    handle,
    ...(opts.name ? { name: opts.name } : {}),
    from: null,
    path: abs,
    createdAt: new Date().toISOString(),
  };
  await withLock(home, async () => {
    const fresh = await loadData(home);
    fresh.instances.push(instance);
    await saveData(home, fresh);
  });
  return instance;
}

// Tear down an instance. Idempotent: an unknown/already-gone handle succeeds
// quietly so a reaper never wedges. Returns whether anything was tracked.
export async function deleteInstance(
  root: string,
  manifest: ProjectManifest,
  handle: string,
): Promise<boolean> {
  const home = await dataHome(root);
  const state = await loadData(home);
  const inst = findInstance(state, handle);
  if (!inst) return false;

  // A `link`ed instance points at a directory premo doesn't own: never run teardown
  // (wired or built-in) against it — just drop it from the registry below.
  if (!inst.path) {
    const wired = manifest.data?.delete;
    if (wired) {
      const injected: Record<string, string> = { PREMO_DATA_HANDLE: handle };
      if (manifest.data?.dir) injected.PREMO_DATA_DIR = instanceDirAt(home, handle);
      await runScript(root, manifest, wired, injected);
    } else if (manifest.data?.dir) {
      await rm(instanceDirAt(home, handle), { recursive: true, force: true });
    }
  }

  await withLock(home, async () => {
    const fresh = await loadData(home);
    fresh.instances = fresh.instances.filter((i) => i.handle !== handle);
    await saveData(home, fresh);
  });
  return true;
}

export async function listInstances(root: string): Promise<DataState> {
  return loadData(await dataHome(root));
}

// --- run-env injection -------------------------------------------------------

// The directory-adapter env for a given absolute instance/live dir: PREMO_DATA_DIR
// plus the app's native vars (`data.env`) with `${PREMO_DATA_DIR}` interpolated, so
// the app finds its data at `dataDir` without being changed to read PREMO_DATA_DIR.
function dirEnv(manifest: ProjectManifest, dataDir: string): Record<string, string> {
  const env: Record<string, string> = { PREMO_DATA_DIR: dataDir };
  const map = manifest.data?.env;
  if (map) {
    for (const [k, v] of Object.entries(map))
      env[k] = interpolateEnv(v, { PREMO_DATA_DIR: dataDir });
  }
  return env;
}

// The env premo injects into a `dev --data <handle>` run: the opaque handle, plus
// the directory-adapter vars for the instance. Returns null for an unknown handle.
export async function dataRunEnv(
  root: string,
  manifest: ProjectManifest,
  handle: string,
): Promise<Record<string, string> | null> {
  const home = await dataHome(root);
  const state = await loadData(home);
  const inst = findInstance(state, handle);
  if (!inst) return null;
  const env: Record<string, string> = { PREMO_DATA_HANDLE: handle };
  if (manifest.data?.dir) Object.assign(env, dirEnv(manifest, resolvedDir(home, inst)));
  return env;
}

// The env for a plain `dev` (no --data) under the directory adapter: point the app
// at its live `dir` so the same data vars are always present (one code path).
export function liveDataEnv(root: string, manifest: ProjectManifest): Record<string, string> {
  const dir = manifest.data?.dir;
  return dir ? dirEnv(manifest, path.join(root, dir)) : {};
}

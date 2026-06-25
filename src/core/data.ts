import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ProjectManifest } from "../manifest/types.js";
import { loadLocal, saveLocal, type DataInstance, type DataState } from "./local.js";
import { envFileVars, configEnv, interpolateEnv } from "./env.js";

// The data axis (DATA-DIRECTORIES.md). premo owns an opaque handle per isolated
// data instance + the registry (in .premo-local.json); the repo owns the physical
// state, addressed by the handle. Either wired lifecycle scripts (Contract A) or
// the built-in directory adapter (Contract B, `data.dir`) realize an instance.

// premo-owned instance storage for the directory adapter: a directory per handle
// under the gitignored `.premo/` tree.
export const DATA_ROOT = path.join(".premo", "data");

// The reserved source name for "the project's live working data" (`data.dir`),
// so a golden dataset can be bootstrapped straight from a hand-curated one:
//   premo data clone live --name golden
export const LIVE = "live";

export class DataError extends Error {}

export function instanceDir(root: string, handle: string): string {
  return path.join(root, DATA_ROOT, handle);
}

type Action = "create" | "clone" | "delete";

function mintHandle(existing: Set<string>): string {
  for (;;) {
    const handle = "d_" + randomBytes(4).toString("hex").slice(0, 6);
    if (!existing.has(handle)) return handle;
  }
}

async function loadData(root: string): Promise<DataState> {
  return (await loadLocal(root)).data ?? { instances: [] };
}

async function saveData(root: string, data: DataState): Promise<void> {
  const state = await loadLocal(root);
  state.data = data;
  await saveLocal(root, state);
}

export function findInstance(data: DataState, handle: string): DataInstance | undefined {
  return data.instances.find((i) => i.handle === handle);
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
// — for the directory adapter — its on-disk path.
function resolveSource(
  root: string,
  manifest: ProjectManifest,
  data: DataState,
  from: string,
): { fromLabel: string; fromPath: string | undefined } {
  if (from === LIVE) {
    const dir = manifest.data?.dir;
    if (!dir) throw new DataError(`source "${LIVE}" needs a directory adapter (set data.dir)`);
    return { fromLabel: LIVE, fromPath: path.join(root, dir) };
  }
  if (!findInstance(data, from)) throw new DataError(`unknown source handle "${from}"`);
  return { fromLabel: from, fromPath: instanceDir(root, from) };
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

  const state = await loadData(root);
  const handle = mintHandle(new Set(state.instances.map((i) => i.handle)));

  let fromLabel: string | null = null;
  let fromPath: string | undefined;
  if (opts.from) {
    const src = resolveSource(root, manifest, state, opts.from);
    fromLabel = src.fromLabel;
    fromPath = src.fromPath;
  }

  const wired = data[action];
  if (wired) {
    const injected: Record<string, string> = { PREMO_DATA_HANDLE: handle };
    if (data.dir) injected.PREMO_DATA_DIR = instanceDir(root, handle);
    if (fromLabel) injected.PREMO_DATA_FROM = fromLabel;
    if (fromPath && data.dir) injected.PREMO_DATA_FROM_DIR = fromPath;
    await runScript(root, manifest, wired, injected);
  } else {
    // Directory adapter built-in.
    const dst = instanceDir(root, handle);
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
  state.instances.push(instance);
  await saveData(root, state);
  return instance;
}

// Tear down an instance. Idempotent: an unknown/already-gone handle succeeds
// quietly so a reaper never wedges. Returns whether anything was tracked.
export async function deleteInstance(
  root: string,
  manifest: ProjectManifest,
  handle: string,
): Promise<boolean> {
  const state = await loadData(root);
  const inst = findInstance(state, handle);
  if (!inst) return false;

  const wired = manifest.data?.delete;
  if (wired) {
    const injected: Record<string, string> = { PREMO_DATA_HANDLE: handle };
    if (manifest.data?.dir) injected.PREMO_DATA_DIR = instanceDir(root, handle);
    await runScript(root, manifest, wired, injected);
  } else if (manifest.data?.dir) {
    await rm(instanceDir(root, handle), { recursive: true, force: true });
  }

  state.instances = state.instances.filter((i) => i.handle !== handle);
  await saveData(root, state);
  return true;
}

export async function listInstances(root: string): Promise<DataState> {
  return loadData(root);
}

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
  const state = await loadData(root);
  if (!findInstance(state, handle)) return null;
  const env: Record<string, string> = { PREMO_DATA_HANDLE: handle };
  if (manifest.data?.dir) Object.assign(env, dirEnv(manifest, instanceDir(root, handle)));
  return env;
}

// The env for a plain `dev` (no --data) under the directory adapter: point the app
// at its live `dir` so the same data vars are always present (one code path).
export function liveDataEnv(root: string, manifest: ProjectManifest): Record<string, string> {
  const dir = manifest.data?.dir;
  return dir ? dirEnv(manifest, path.join(root, dir)) : {};
}

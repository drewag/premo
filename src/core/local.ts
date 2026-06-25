import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Worktree-local, gitignored state (DESIGN.md §5): background PIDs, the last
// xcode run destination, etc. Owned here so several features can share the file
// without stepping on each other's keys.
export const LOCAL_FILE = ".premo-local.json";

export interface BackgroundProc {
  name: string;
  pid: number;
  pgid: number;
  logPath: string;
  command: string;
  startedAt: string;
}

// A remembered xcode run destination — structurally a subset of xcode's
// Destination, kept dependency-free here to avoid an import cycle.
export interface StoredDestination {
  dest: string;
  label: string;
  bootUdid?: string;
  deviceUdid?: string;
}

// A tracked data instance (DATA-DIRECTORIES.md §3.4). premo owns this registry;
// the `handle` is the only public reference. `from` records the source handle a
// clone was made from (or `live`). Every instance persists until `delete` — premo
// has no lifecycle/reaping policy of its own. `ref` is an optional opaque descriptor
// a non-deterministic substrate's `create` script may emit on stdout for premo to
// replay (reserved; see §3.3) — the directory adapter derives its path from the
// handle and never sets it.
export interface DataInstance {
  handle: string;
  name?: string;
  from?: string | null;
  createdAt: string;
  ref?: string;
}

export interface DataState {
  instances: DataInstance[];
}

export interface LocalState {
  background?: BackgroundProc[];
  lastXcodeDest?: StoredDestination;
  data?: DataState;
}

function localPath(root: string): string {
  return path.join(root, LOCAL_FILE);
}

export async function loadLocal(root: string): Promise<LocalState> {
  const file = localPath(root);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await readFile(file, "utf8")) as LocalState;
  } catch {
    return {};
  }
}

export async function saveLocal(root: string, state: LocalState): Promise<void> {
  await writeFile(localPath(root), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function readLastXcodeDest(root: string): Promise<StoredDestination | undefined> {
  return (await loadLocal(root)).lastXcodeDest;
}

export async function writeLastXcodeDest(root: string, dest: StoredDestination): Promise<void> {
  const state = await loadLocal(root);
  state.lastXcodeDest = dest;
  await saveLocal(root, state);
}

// premo-owned, never-committed paths: local state, background logs, and the
// xcode build cache. Appended to .gitignore at adopt time so a `dev` run never
// leaves a huge DerivedData dir or machine-local state staged.
const IGNORED_PATHS = [LOCAL_FILE, ".runtime/", ".premo/"];

export async function ensurePremoGitignore(root: string): Promise<void> {
  const file = path.join(root, ".gitignore");
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORED_PATHS.filter((p) => !lines.has(p));
  if (missing.length === 0) return;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await writeFile(file, `${current}${prefix}\n# premo\n${missing.join("\n")}\n`, "utf8");
}

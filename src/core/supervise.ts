import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { type BackgroundProc, loadLocal, saveLocal } from "./local.js";

export type { BackgroundProc };

// `.runtime/` holds background process logs (gitignored). The only consumer is
// supervision below, so the dir helpers live here.
const RUNTIME_DIR = ".runtime";

function runtimeDir(root: string): string {
  return path.join(root, RUNTIME_DIR);
}

async function ensureRuntimeDir(root: string): Promise<string> {
  const dir = runtimeDir(root);
  await mkdir(dir, { recursive: true });
  return dir;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function listBackground(root: string): Promise<BackgroundProc[]> {
  const state = await loadLocal(root);
  return (state.background ?? []).filter((p) => isAlive(p.pid));
}

// Spawn a command detached in its own process group, logging to .runtime/<name>.log.
export async function spawnDetached(
  root: string,
  name: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<BackgroundProc> {
  await ensureRuntimeDir(root);
  const logPath = path.join(runtimeDir(root), `${name}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();

  const pid = child.pid ?? -1;
  const proc: BackgroundProc = {
    name,
    pid,
    pgid: pid, // detached ⇒ child is its own group leader
    logPath,
    command,
    startedAt: new Date().toISOString(),
  };

  const state = await loadLocal(root);
  state.background = [...(state.background ?? []).filter((p) => p.name !== name), proc];
  await saveLocal(root, state);
  return proc;
}

// Kill all tracked background process groups. Returns the names stopped.
export async function stopBackground(root: string): Promise<string[]> {
  const state = await loadLocal(root);
  const procs = state.background ?? [];
  const stopped: string[] = [];
  for (const p of procs) {
    try {
      process.kill(-p.pgid, "SIGTERM"); // negative pid ⇒ whole group
      stopped.push(p.name);
    } catch {
      /* already gone */
    }
  }
  state.background = [];
  await saveLocal(root, state);
  return stopped;
}

// Follow logs of background processes (all, or one named). Blocks until Ctrl-C.
export async function tailLogs(root: string, name?: string): Promise<void> {
  const procs = await listBackground(root);
  const chosen = name ? procs.filter((p) => p.name === name) : procs;
  const paths = chosen.map((p) => p.logPath).filter((p) => existsSync(p));
  if (paths.length === 0) return;
  await execa("tail", ["-n", "40", "-f", ...paths], { cwd: root, stdio: "inherit", reject: false });
}

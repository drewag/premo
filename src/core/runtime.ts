import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RUNTIME_DIR = ".runtime";

export function runtimeDir(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_DIR);
}

export async function ensureRuntimeDir(projectRoot: string): Promise<string> {
  const dir = runtimeDir(projectRoot);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writePid(projectRoot: string, name: string, pid: number): Promise<void> {
  await ensureRuntimeDir(projectRoot);
  await writeFile(path.join(runtimeDir(projectRoot), `${name}.pid`), String(pid), "utf8");
}

export async function readPid(projectRoot: string, name: string): Promise<number | null> {
  const file = path.join(runtimeDir(projectRoot), `${name}.pid`);
  if (!existsSync(file)) return null;
  const n = parseInt(await readFile(file, "utf8"), 10);
  return Number.isFinite(n) ? n : null;
}

export async function clearPid(projectRoot: string, name: string): Promise<void> {
  const file = path.join(runtimeDir(projectRoot), `${name}.pid`);
  if (existsSync(file)) await unlink(file);
}

export async function writePortsManifest(
  projectRoot: string,
  ports: Record<string, number>,
): Promise<void> {
  await ensureRuntimeDir(projectRoot);
  await writeFile(
    path.join(runtimeDir(projectRoot), "ports.json"),
    JSON.stringify(ports, null, 2) + "\n",
    "utf8",
  );
}

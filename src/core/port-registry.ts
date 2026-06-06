import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BASE_MIN,
  DEFAULT_BASE_MAX,
  DEFAULT_BLOCK,
  defaultBaseForProject,
} from "./ports.js";

// Host-global registry of port-block allocations, so every premo-managed
// project on the machine gets a conflict-free block. Keyed by absolute
// project path. Seeds from the hash-derived base, then steps past anything
// already registered — replacing "hash-and-hope" with a tracked guarantee.

export interface PortAllocationRecord {
  name: string;
  base: number;
  block: number;
}

interface RegistryFile {
  projects: Record<string, PortAllocationRecord>;
}

export function registryDir(): string {
  return process.env.PREMO_HOME ?? path.join(os.homedir(), ".premo");
}

export function registryPath(): string {
  return path.join(registryDir(), "registry.json");
}

async function load(): Promise<RegistryFile> {
  const file = registryPath();
  if (!existsSync(file)) return { projects: {} };
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<RegistryFile>;
    return { projects: raw.projects ?? {} };
  } catch {
    return { projects: {} };
  }
}

async function save(data: RegistryFile): Promise<void> {
  await mkdir(registryDir(), { recursive: true });
  await writeFile(registryPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function getAllocation(projectPath: string): Promise<PortAllocationRecord | null> {
  const data = await load();
  return data.projects[path.resolve(projectPath)] ?? null;
}

// Allocate (or return the existing) port block for a project. Idempotent.
export async function allocatePortBlock(
  projectPath: string,
  name: string,
  block: number = DEFAULT_BLOCK,
): Promise<PortAllocationRecord> {
  const key = path.resolve(projectPath);
  const data = await load();
  const existing = data.projects[key];
  if (existing) return existing;

  const takenBases = new Set(Object.values(data.projects).map((p) => p.base));
  const span = DEFAULT_BASE_MAX - DEFAULT_BASE_MIN;
  const seed = defaultBaseForProject(name);

  let base = seed;
  for (let i = 0; i < span / block; i++) {
    const candidate = DEFAULT_BASE_MIN + ((seed - DEFAULT_BASE_MIN + i * block) % span);
    if (!takenBases.has(candidate)) {
      base = candidate;
      break;
    }
  }

  const record: PortAllocationRecord = { name, base, block };
  data.projects[key] = record;
  await save(data);
  return record;
}

export async function releaseAllocation(projectPath: string): Promise<void> {
  const data = await load();
  delete data.projects[path.resolve(projectPath)];
  await save(data);
}

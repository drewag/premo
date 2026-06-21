import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
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

// The registry is host-global, so two `premo` processes adopting different
// projects at once would otherwise race the load→mutate→save and clobber one
// another's allocation. Serialize the mutating section with an exclusive-create
// lock file. Bounded wait: on timeout we assume a crashed holder left a stale
// lock, drop it, and proceed — better a tiny race window than a hung `adopt`.
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2000;

function lockPath(): string {
  return path.join(registryDir(), "registry.lock");
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(registryDir(), { recursive: true });
  const file = lockPath();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(file, "wx"); // exclusive create — fails if held
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        await rm(file, { force: true }); // assume stale; steal it
        break;
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(file, { force: true });
  }
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
  return withLock(async () => {
    const data = await load();
    const existing = data.projects[key];
    if (existing) return existing;

    const takenBases = new Set(Object.values(data.projects).map((p) => p.base));
    const span = DEFAULT_BASE_MAX - DEFAULT_BASE_MIN;
    const seed = defaultBaseForProject(name);

    // Walk every block-aligned slot once, starting at the hash-derived seed, and
    // take the first free one. No free slot ⇒ throw rather than reuse a taken
    // base (a silent port collision is worse than a loud, rare failure).
    let base: number | null = null;
    for (let i = 0; i < span / block; i++) {
      const candidate = DEFAULT_BASE_MIN + ((seed - DEFAULT_BASE_MIN + i * block) % span);
      if (!takenBases.has(candidate)) {
        base = candidate;
        break;
      }
    }
    if (base === null) {
      throw new Error(
        `Port registry is full (${takenBases.size} blocks of ${block} in ` +
          `${DEFAULT_BASE_MIN}–${DEFAULT_BASE_MAX}). Release one with \`premo\` or edit ` +
          `${registryPath()}.`,
      );
    }

    const record: PortAllocationRecord = { name, base, block };
    data.projects[key] = record;
    await save(data);
    return record;
  });
}

export async function releaseAllocation(projectPath: string): Promise<void> {
  await withLock(async () => {
    const data = await load();
    delete data.projects[path.resolve(projectPath)];
    await save(data);
  });
}

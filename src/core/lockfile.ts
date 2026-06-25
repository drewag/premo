import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

// An exclusive-create file lock for serializing the read→mutate→write of a
// host-global registry across concurrent `premo` processes. Used by both the
// port-block registry (port-registry.ts) and the global data registry (data.ts):
// two processes mutating the same JSON file would otherwise clobber one another.
//
// Bounded wait: on timeout we assume a crashed holder left a stale lock, drop it,
// and proceed — better a tiny race window than a hung command. Holders must keep
// the critical section short (load → mutate → save), never wrapping slow work
// (a CoW copy, a wired script) so the timeout never trips a live holder.
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2000;

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx"); // exclusive create — fails if held
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        await rm(lockPath, { force: true }); // assume stale; steal it
        break;
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

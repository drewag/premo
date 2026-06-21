import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listBackground, spawnDetached, stopBackground } from "../../src/core/supervise.js";

// supervise.ts spawns/tracks/kills detached background processes via the local
// state file. These tests use real short-lived child processes (a node sleeper)
// and kill everything they spawn in cleanup so the suite never leaks.

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-supervise-"));
}

// A trivial, portable, long-lived command (CI is Node 22+).
const SLEEPER = `node -e "setTimeout(()=>{},60000)"`;

// Track every pid we spawn across the run so cleanup is bulletproof.
const spawnedPids = new Set<number>();

function track(pid: number): void {
  if (pid > 0) spawnedPids.add(pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(-pid, "SIGKILL"); // whole group (detached ⇒ group leader)
    } catch {
      /* ignore */
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
  spawnedPids.clear();
});

describe("spawnDetached", () => {
  it("records the proc in local state and creates a log file", async () => {
    const dir = await root();
    const proc = await spawnDetached(dir, "dev", SLEEPER, dir, process.env);
    track(proc.pid);

    expect(proc.name).toBe("dev");
    expect(proc.pid).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, ".runtime", "dev.log"))).toBe(true);

    const tracked = await listBackground(dir);
    expect(tracked.map((p) => p.name)).toEqual(["dev"]);
    expect(tracked[0]!.pid).toBe(proc.pid);
  });

  it("replaces an earlier proc with the same name in state", async () => {
    const dir = await root();
    const first = await spawnDetached(dir, "dev", SLEEPER, dir, process.env);
    track(first.pid);
    const second = await spawnDetached(dir, "dev", SLEEPER, dir, process.env);
    track(second.pid);

    expect(second.pid).not.toBe(first.pid);
    const tracked = await listBackground(dir);
    expect(tracked.map((p) => p.name)).toEqual(["dev"]);
    expect(tracked[0]!.pid).toBe(second.pid);
  });
});

describe("listBackground", () => {
  it("filters out dead pids", async () => {
    const dir = await root();
    const proc = await spawnDetached(dir, "dev", SLEEPER, dir, process.env);
    track(proc.pid);
    expect((await listBackground(dir)).map((p) => p.name)).toEqual(["dev"]);

    process.kill(proc.pid, "SIGKILL");
    // wait for the process to actually die
    for (let i = 0; i < 100 && isAlive(proc.pid); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(await listBackground(dir)).toEqual([]);
  });
});

describe("stopBackground", () => {
  it("kills tracked processes and clears state", async () => {
    const dir = await root();
    const a = await spawnDetached(dir, "a", SLEEPER, dir, process.env);
    track(a.pid);
    const b = await spawnDetached(dir, "b", SLEEPER, dir, process.env);
    track(b.pid);
    expect((await listBackground(dir)).length).toBe(2);

    const stopped = await stopBackground(dir);
    expect(new Set(stopped)).toEqual(new Set(["a", "b"]));

    // wait for the killed processes to die
    for (let i = 0; i < 100 && (isAlive(a.pid) || isAlive(b.pid)); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(isAlive(a.pid)).toBe(false);
    expect(isAlive(b.pid)).toBe(false);
    expect(await listBackground(dir)).toEqual([]);
  });
});

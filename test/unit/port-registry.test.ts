import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_BASE_MIN,
  DEFAULT_BASE_MAX,
  DEFAULT_BLOCK,
  defaultBaseForProject,
} from "../../src/core/ports.js";
import { allocatePortBlock as allocate, registryPath } from "../../src/core/port-registry.js";

describe("global port registry", () => {
  let allocatePortBlock: typeof import("../../src/core/port-registry.js").allocatePortBlock;
  let getAllocation: typeof import("../../src/core/port-registry.js").getAllocation;

  beforeAll(async () => {
    process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-"));
    const mod = await import("../../src/core/port-registry.js");
    allocatePortBlock = mod.allocatePortBlock;
    getAllocation = mod.getAllocation;
  });

  it("seeds from the hash-derived base", async () => {
    const rec = await allocatePortBlock("/projects/alpha", "alpha");
    expect(rec.base).toBe(defaultBaseForProject("alpha"));
    expect(rec.block).toBe(100);
  });

  it("is idempotent per project path", async () => {
    const a = await allocatePortBlock("/projects/beta", "beta");
    const b = await allocatePortBlock("/projects/beta", "beta");
    expect(b).toEqual(a);
  });

  it("assigns a different block when the seed is taken (same name, different path)", async () => {
    const first = await allocatePortBlock("/projects/one", "samename");
    const second = await allocatePortBlock("/projects/two", "samename");
    expect(second.base).not.toBe(first.base);
    expect(second.base).toBeGreaterThanOrEqual(DEFAULT_BASE_MIN);
    expect(second.base).toBeLessThan(DEFAULT_BASE_MAX);
  });

  it("persists allocations across reads", async () => {
    await allocatePortBlock("/projects/gamma", "gamma");
    expect((await getAllocation("/projects/gamma"))?.name).toBe("gamma");
  });
});

describe("global port registry — concurrency & exhaustion", () => {
  it("gives every project a distinct base under concurrent allocation", async () => {
    process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-conc-"));
    // Same name on purpose: identical seeds ⇒ maximal contention. The lock must
    // serialize the load→mutate→save so no two paths land on the same base.
    const n = 50;
    const recs = await Promise.all(
      Array.from({ length: n }, (_, i) => allocate(`/projects/p${i}`, "collide")),
    );
    expect(new Set(recs.map((r) => r.base)).size).toBe(n);
  });

  it("throws rather than reusing a taken base when the range is full", async () => {
    process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-full-"));
    // Pre-seed every slot in the range so nothing is free.
    const slots = (DEFAULT_BASE_MAX - DEFAULT_BASE_MIN) / DEFAULT_BLOCK;
    const projects: Record<string, { name: string; base: number; block: number }> = {};
    for (let i = 0; i < slots; i++) {
      projects[`/seed/${i}`] = {
        name: `seed${i}`,
        base: DEFAULT_BASE_MIN + i * DEFAULT_BLOCK,
        block: DEFAULT_BLOCK,
      };
    }
    await writeFile(registryPath(), JSON.stringify({ projects }), "utf8");

    await expect(allocate("/projects/overflow", "overflow")).rejects.toThrow(/registry is full/i);
  });
});

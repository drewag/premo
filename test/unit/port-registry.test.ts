import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BASE_MIN, DEFAULT_BASE_MAX, defaultBaseForProject } from "../../src/core/ports.js";

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

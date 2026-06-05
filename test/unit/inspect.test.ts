import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectContext } from "../../src/core/context.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "strand-inspect-"));
}

describe("inspectContext (doctor's read-only probe)", () => {
  it("detects an un-adopted package WITHOUT writing strand.json", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "thing", scripts: { build: "tsc" } }),
    );

    const res = await inspectContext(dir);
    expect(res.adopted).toBe(false);
    expect(res.adapterName).toBe("node-scripts");
    expect(res.manifest.targets.thing).toBeDefined();
    expect(existsSync(path.join(dir, "strand.json"))).toBe(false); // never writes
  });

  it("reports adopted when a strand.json is present", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "strand.json"),
      JSON.stringify({ name: "thing", commands: { build: "make" } }),
    );
    const res = await inspectContext(dir);
    expect(res.adopted).toBe(true);
    expect(res.manifest.commands.build).toBe("make");
  });
});

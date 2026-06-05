import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveTargets } from "../../src/core/targets.js";
import { ProjectManifest } from "../../src/strand-api/types.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "strand-targets-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("resolveTargets", () => {
  it("resolves adapter commands for a single package", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc", test: "vitest" } });
    const manifest = ProjectManifest.parse({ name: "app", adapter: "node-scripts" });

    const targets = await resolveTargets(root, manifest);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.commands.build).toBe("yarn build");
    expect(targets[0]!.commands.test).toBe("yarn test");
  });

  it("lets project-level commands override the adapter", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
    });
    const targets = await resolveTargets(root, manifest);
    expect(targets[0]!.commands.build).toBe("make build");
  });

  it("lets a per-target override beat the project default", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
      targets: { app: { commands: { build: "bespoke" } } },
    });
    const targets = await resolveTargets(root, manifest);
    expect(targets[0]!.commands.build).toBe("bespoke");
  });

  it("synthesizes an implicit target from project commands when no adapter matches", async () => {
    const root = await tmp(); // empty dir, no package.json
    const manifest = ProjectManifest.parse({ name: "thing", commands: { build: "make" } });
    const targets = await resolveTargets(root, manifest);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe("thing");
    expect(targets[0]!.commands.build).toBe("make");
  });
});

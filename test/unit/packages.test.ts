import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePackages } from "../../src/core/packages.js";
import { ProjectManifest } from "../../src/manifest/types.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-packages-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("resolvePackages", () => {
  it("resolves adapter commands for a single package", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc", test: "vitest" } });
    const manifest = ProjectManifest.parse({ name: "app", adapter: "node-scripts" });

    const packages = await resolvePackages(root, manifest);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.commands.build).toBe("yarn build");
    expect(packages[0]!.commands.test).toBe("yarn test");
  });

  it("lets project-level commands override the adapter", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
    });
    const packages = await resolvePackages(root, manifest);
    expect(packages[0]!.commands.build).toBe("make build");
  });

  it("lets a per-package override beat the project default", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
      packages: [{ name: "app", commands: { build: "bespoke" } }],
    });
    const packages = await resolvePackages(root, manifest);
    expect(packages[0]!.commands.build).toBe("bespoke");
  });

  it("synthesizes an implicit package from project commands when no adapter matches", async () => {
    const root = await tmp(); // empty dir, no package.json
    const manifest = ProjectManifest.parse({ name: "thing", commands: { build: "make" } });
    const packages = await resolvePackages(root, manifest);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.name).toBe("thing");
    expect(packages[0]!.commands.build).toBe("make");
  });
});

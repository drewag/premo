import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findProjectRoot, loadProject, saveProject } from "../../src/core/project.js";

describe("project manifest", () => {
  it("round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await saveProject(dir, {
      name: "myapp",
      version: "0",
      commands: { dev: "yarn dev", build: "yarn build" },
      ports: { base: 4000, block: 100 },
    });
    const loaded = await loadProject(dir);
    expect(loaded.name).toBe("myapp");
    expect(loaded.commands).toEqual({ dev: "yarn dev", build: "yarn build" });
  });

  it("rejects invalid project name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await writeFile(path.join(dir, "premo.json"), JSON.stringify({ name: "BadName" }));
    await expect(loadProject(dir)).rejects.toThrow();
  });

  it("gives a migration message for a pre-split config (object `targets`)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await writeFile(
      path.join(dir, "premo.json"),
      JSON.stringify({ name: "old", targets: { web: { dirs: ["web/"] } } }),
    );
    await expect(loadProject(dir)).rejects.toThrow(/predates the package\/target split/);
  });

  it("accepts the new array-shaped `packages` and `targets`", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await writeFile(
      path.join(dir, "premo.json"),
      JSON.stringify({
        name: "new",
        packages: [{ name: "web", dirs: ["web/"] }],
        targets: [{ name: "web", packages: ["web"] }],
      }),
    );
    const loaded = await loadProject(dir);
    expect(loaded.packages.map((p) => p.name)).toEqual(["web"]);
    expect(loaded.targets.map((t) => t.name)).toEqual(["web"]);
  });

  it("findProjectRoot walks upward", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await saveProject(dir, { name: "myapp", version: "0", commands: { dev: "yarn dev" } });
    const subdir = path.join(dir, "deep", "nested");
    await (await import("node:fs/promises")).mkdir(subdir, { recursive: true });
    expect(findProjectRoot(subdir)).toBe(dir);
  });
});

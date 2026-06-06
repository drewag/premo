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

  it("findProjectRoot walks upward", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-proj-"));
    await saveProject(dir, { name: "myapp", version: "0", commands: { dev: "yarn dev" } });
    const subdir = path.join(dir, "deep", "nested");
    await (await import("node:fs/promises")).mkdir(subdir, { recursive: true });
    expect(findProjectRoot(subdir)).toBe(dir);
  });
});

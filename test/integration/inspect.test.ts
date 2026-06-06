import { describe, expect, it } from "vitest";
import { runPremo, makeNodeApp, makeWorkspaces } from "./helpers.js";

describe("inspect commands (integration)", () => {
  it("doctor --json reports adapter, git readiness, and host checks", async () => {
    const dir = await makeNodeApp();
    const out = JSON.parse((await runPremo(["doctor", "--json"], { cwd: dir })).stdout);
    expect(out.project.adapter).toBe("node-scripts");
    expect(out.project.git.repo).toBe(true);
    expect(Array.isArray(out.host)).toBe(true);
  });

  it("__complete completes target names from the project", async () => {
    const dir = await makeWorkspaces();
    const r = await runPremo(["__complete", "--", "build", ""], { cwd: dir });
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(new Set(lines)).toEqual(new Set(["a", "b"]));
  });

  it("completion zsh prints a stub", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["completion", "zsh"], { cwd: dir });
    expect(r.stdout).toContain("#compdef premo");
  });

  it("skill --stdout prints the verb contract", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["skill", "--stdout"], { cwd: dir });
    expect(r.stdout.toLowerCase()).toContain("wire up");
  });
});

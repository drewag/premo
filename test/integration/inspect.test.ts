import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPremo, makeNodeApp, makeWorkspaces } from "./helpers.js";

describe("inspect commands (integration)", () => {
  it("doctor --json reports adapter, git readiness, and host checks", async () => {
    const dir = await makeNodeApp();
    const out = JSON.parse((await runPremo(["doctor", "--json"], { cwd: dir })).stdout);
    expect(out.project.adapter).toBe("node-scripts");
    expect(out.project.git.repo).toBe(true);
    expect(Array.isArray(out.host)).toBe(true);
    expect(out.project.environments).toEqual([]); // no environments block ⇒ single implicit env
  });

  it("doctor --json and --env completion surface the environments axis", async () => {
    const dir = await makeNodeApp();
    await writeFile(
      path.join(dir, "premo.json"),
      JSON.stringify({
        name: "app",
        environments: [
          { name: "dev", default: true },
          { name: "prod", deploy: true },
        ],
      }),
    );
    const out = JSON.parse((await runPremo(["doctor", "--json"], { cwd: dir })).stdout);
    expect(out.project.environments).toEqual([
      { name: "dev", default: true, deploy: false },
      { name: "prod", default: false, deploy: true },
    ]);

    const r = await runPremo(["__complete", "--", "dev", "--env", ""], { cwd: dir });
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(new Set(lines)).toEqual(new Set(["dev", "prod"]));
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

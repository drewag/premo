import { describe, expect, it } from "vitest";
import { runPremo, makeNodeApp, makeWorkspaces, makeCli } from "./helpers.js";

describe("adopt (integration)", () => {
  it("detects a single-package node app", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["adopt", "--json"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.adapter).toBe("node-scripts");
    expect(out.packages).toContain("app");
  });

  it("detects a workspaces monorepo with a target per package", async () => {
    const dir = await makeWorkspaces();
    const out = JSON.parse((await runPremo(["adopt", "--json"], { cwd: dir })).stdout);
    expect(out.adapter).toBe("workspaces");
    expect(new Set(out.packages)).toEqual(new Set(["a", "b"]));
  });

  it("detects a CLI package and bakes dev + deploy, no port", async () => {
    const dir = await makeCli();
    const out = JSON.parse((await runPremo(["adopt", "--json"], { cwd: dir })).stdout);
    expect(out.adapter).toBe("cli");
    expect(out.commands.dev).toBe("node dist/cli.js");
    expect(out.commands.deploy).toBe("npm publish");
    expect(out.ports).toBeNull();
  });
});

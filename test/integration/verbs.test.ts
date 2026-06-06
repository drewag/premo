import { describe, expect, it } from "vitest";
import { runPremo, makeNodeApp, makeWorkspaces, dirtyEdit } from "./helpers.js";

describe("verbs (integration)", () => {
  it("runs build and surfaces the script's output", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["build"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("BUILD_OK");
  });

  it("runs lint", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["lint"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LINT_OK");
  });

  it("fails (non-zero) when a command fails", async () => {
    const dir = await makeNodeApp({ build: "exit 7" });
    const r = await runPremo(["build"], { cwd: dir });
    expect(r.exitCode).not.toBe(0);
  });

  it("fails on an unknown target", async () => {
    const dir = await makeNodeApp();
    const r = await runPremo(["build", "nope"], { cwd: dir });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("No target");
  });

  it("builds only the affected target in a monorepo", async () => {
    const dir = await makeWorkspaces();
    await dirtyEdit(dir, "packages/a/x.txt"); // uncommitted change in package a only
    const r = await runPremo(["build"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("AFFECTED_A");
    expect(r.stdout).not.toContain("AFFECTED_B");
  });
});

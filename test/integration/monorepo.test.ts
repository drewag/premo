import { describe, expect, it } from "vitest";
import { runPremo, makeManualMonorepo, dirtyEdit } from "./helpers.js";

// End-to-end coverage of the manual-monorepo flow (DESIGN §13) against the built
// binary: discovery, the two axes, affected build, per-target ports, deploy.
describe("manual monorepo (integration)", () => {
  it("adopt detects a monorepo with packages keyed by directory + a port block", async () => {
    const dir = await makeManualMonorepo();
    const out = JSON.parse((await runPremo(["adopt", "--json"], { cwd: dir })).stdout);
    expect(out.adapter).toBe("monorepo");
    expect(new Set(out.packages)).toEqual(new Set(["api", "shared", "web"]));
    expect(out.ports).not.toBeNull();
  });

  it("doctor reports both axes — packages and serving targets with ports", async () => {
    const dir = await makeManualMonorepo();
    await runPremo(["adopt"], { cwd: dir }); // ports are assigned + persisted at adopt
    const out = JSON.parse((await runPremo(["doctor", "--json"], { cwd: dir })).stdout);
    expect(new Set(out.project.packages.map((p: { name: string }) => p.name))).toEqual(
      new Set(["api", "shared", "web"]),
    );
    const targets = out.project.targets as { name: string; port: number | null }[];
    expect(new Set(targets.map((t) => t.name))).toEqual(new Set(["api", "web"]));
    const ports = targets.filter((t) => t.port !== null).map((t) => t.port);
    expect(ports).toHaveLength(2);
    expect(new Set(ports).size).toBe(2); // distinct per target
  });

  it("build runs only the affected package", async () => {
    const dir = await makeManualMonorepo();
    await dirtyEdit(dir, "api/x.txt");
    const r = await runPremo(["build"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("AFFECTED_API");
    expect(r.stdout).not.toContain("AFFECTED_WEB");
  });

  it("ports lists a distinct port per serving target", async () => {
    const dir = await makeManualMonorepo();
    await runPremo(["adopt"], { cwd: dir });
    const out = JSON.parse((await runPremo(["ports", "--json"], { cwd: dir })).stdout);
    const names = (out.targets as { name: string; port: number }[]).map((t) => t.name).sort();
    expect(names).toEqual(["api", "web"]);
  });

  it("deploy <target> ships that target via the root deploy:<name> script", async () => {
    const dir = await makeManualMonorepo();
    const r = await runPremo(["deploy", "web"], { cwd: dir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("DEPLOYED_WEB");
  });

  it("bare dev with several targets and no default asks which to run", async () => {
    const dir = await makeManualMonorepo();
    const r = await runPremo(["dev"], { cwd: dir });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Multiple targets");
  });
});

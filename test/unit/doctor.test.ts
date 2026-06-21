import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatherProject } from "../../src/cli/commands/doctor.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-doctor-"));
}

describe("gatherProject (doctor's project report)", () => {
  it("reports a fully-wired node package", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: { build: "tsc", test: "vitest", lint: "eslint .", dev: "node ." },
      }),
    );

    const report = await gatherProject(dir);

    expect(report.adopted).toBe(false); // no premo.json, still produces a report
    expect(report.adapter).toBe("node-scripts");

    // packages matrix: the build/test/lint verbs are resolved to commands.
    const pkg = report.packages.find((p) => p.name === "app");
    expect(pkg).toBeDefined();
    expect(pkg!.commands.build).toBeTruthy();
    expect(pkg!.commands.test).toBeTruthy();
    expect(pkg!.commands.lint).toBeTruthy();

    // a package with a dev script becomes a serving target.
    const target = report.targets.find((t) => t.name === "app");
    expect(target).toBeDefined();
    expect(target!.dev).toBe(true);

    // build/test/lint wired (packages), dev wired (target). deploy has no
    // source, so it is the only unwired verb.
    expect(report.unwired).toEqual(["deploy"]);
  });

  it("reports unwired verbs when no build/test/lint/dev scripts exist", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "bare", scripts: { clean: "rm -rf dist" } }),
    );

    const report = await gatherProject(dir);

    // build/test/lint come from packages — none wired here.
    const pkg = report.packages.find((p) => p.name === "bare");
    expect(pkg).toBeDefined();
    expect(pkg!.commands.build).toBeNull();
    expect(pkg!.commands.test).toBeNull();
    expect(pkg!.commands.lint).toBeNull();

    // dev unwired (no target has a dev), deploy unwired (no deploy command).
    expect(report.targets.some((t) => t.dev)).toBe(false);
    expect(report.targets.some((t) => t.deploy)).toBe(false);

    // every verb is unwired in this bare package.
    expect(new Set(report.unwired)).toEqual(new Set(["dev", "build", "test", "lint", "deploy"]));
  });

  it("produces a report for an un-adopted repo without writing premo.json", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "thing", scripts: { build: "tsc" } }),
    );

    const report = await gatherProject(dir);

    expect(report.adopted).toBe(false);
    expect(report.name).toBe("thing");
    expect(report.root).toBe(dir);
    expect(Array.isArray(report.packages)).toBe(true);
    expect(report.environments).toEqual([]);
    expect(existsSync(path.join(dir, "premo.json"))).toBe(false); // read-only probe
  });
});

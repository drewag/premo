import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { adoptProject, syncProject } from "../../src/core/context.js";
import { loadProject } from "../../src/core/project.js";
import type { ProjectManifestInput } from "../../src/manifest/types.js";

// Isolate the host-global port registry so these never touch ~/.premo.
beforeAll(async () => {
  process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-adopt-"));
});

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-adopt-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

// A manual monorepo: a root with a dev-tool bin + a central deploy:<name> script,
// and serving + library members — the odo/email shape in miniature.
async function fixture(): Promise<string> {
  const root = await tmp();
  await pkg(root, { name: "mono", bin: "./bin/dev.ts", scripts: { "deploy:api": "ship-api" } });
  await pkg(path.join(root, "api"), {
    name: "api",
    scripts: { dev: "node .", build: "tsc", test: "jest" },
  });
  await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite", build: "vite build" } });
  await pkg(path.join(root, "shared"), { name: "shared", scripts: { test: "jest" } }); // lib: no target
  return root;
}

describe("adoptProject — manual monorepo", () => {
  it("detects the monorepo and materializes packages keyed by directory", async () => {
    const root = await fixture();
    const m = await adoptProject(root, { quiet: true });
    expect(m.adapter).toBe("monorepo");
    expect(m.packages.map((p) => p.name).sort()).toEqual(["api", "shared", "web"]);
  });

  it("seeds run/deploy targets and auto-wires the root deploy:<name> script", async () => {
    const root = await fixture();
    const m = await adoptProject(root, { quiet: true });
    // shared is a library (no dev, no deploy) → not a target.
    expect(m.targets.map((t) => t.name).sort()).toEqual(["api", "web"]);
    expect(m.targets.find((t) => t.name === "api")!.deploy).toBe("yarn deploy:api");
    expect(m.targets.find((t) => t.name === "web")!.deploy).toBeUndefined();
  });

  it("gives each serving target a distinct base port within the project block", async () => {
    const root = await fixture();
    const m = await adoptProject(root, { quiet: true });
    expect(m.ports).toBeDefined();
    const ports = m.targets.filter((t) => t.ports).map((t) => t.ports!.base);
    expect(ports).toHaveLength(2); // api + web
    expect(new Set(ports).size).toBe(2); // distinct
    for (const p of ports) {
      expect(p).toBeGreaterThanOrEqual(m.ports!.base);
      expect(p).toBeLessThan(m.ports!.base + m.ports!.block);
    }
  });

  it("writes a premo.json that round-trips", async () => {
    const root = await fixture();
    await adoptProject(root, { quiet: true });
    const written = JSON.parse(await readFile(path.join(root, "premo.json"), "utf8"));
    expect(written.adapter).toBe("monorepo");
    expect(Array.isArray(written.packages)).toBe(true);
    expect(Array.isArray(written.targets)).toBe(true);
  });

  it("auto-detects a root .env as the envFile", async () => {
    const root = await fixture();
    await writeFile(path.join(root, ".env"), "DATABASE_URL=postgres://x\n");
    const m = await adoptProject(root, { quiet: true });
    expect(m.envFile).toBe(".env");
  });

  it("leaves envFile unset when there's no .env", async () => {
    const root = await fixture();
    const m = await adoptProject(root, { quiet: true });
    expect(m.envFile ?? null).toBeNull();
  });
});

// Read the raw manifest object for hand-editing in tests (loadProject applies
// defaults; here we want to mutate and write back the on-disk shape).
async function readRaw(root: string): Promise<ProjectManifestInput> {
  return JSON.parse(await readFile(path.join(root, "premo.json"), "utf8")) as ProjectManifestInput;
}
function basePortOf(m: { targets: { name: string; ports?: { base: number } }[] }, name: string) {
  return m.targets.find((t) => t.name === name)?.ports?.base;
}

describe("syncProject — additive re-adopt", () => {
  it("is a no-op when nothing in the repo changed", async () => {
    const root = await fixture();
    await adoptProject(root, { quiet: true });
    const before = await readFile(path.join(root, "premo.json"), "utf8");

    const r = await syncProject(root);
    expect(r.changed).toBe(false);
    // Byte-for-byte stable — a no-op sync must not churn the file.
    expect(await readFile(path.join(root, "premo.json"), "utf8")).toBe(before);
  });

  it("picks up a newly-added package + target and gives it a free port", async () => {
    const root = await fixture();
    await adoptProject(root, { quiet: true });
    const before = await loadProject(root);
    const apiPort = basePortOf(before, "api");
    const webPort = basePortOf(before, "web");

    // A new serving member appears in the repo.
    await pkg(path.join(root, "worker"), { name: "worker", scripts: { dev: "node worker.js" } });
    const r = await syncProject(root);

    expect(r.changed).toBe(true);
    expect(r.changes.packages).toContain("worker");
    expect(r.changes.targets).toContain("worker");

    const after = await loadProject(root);
    // Existing ports are left exactly as they were.
    expect(basePortOf(after, "api")).toBe(apiPort);
    expect(basePortOf(after, "web")).toBe(webPort);
    // The newcomer gets its own distinct base within the block.
    const workerPort = basePortOf(after, "worker");
    expect(workerPort).toBeDefined();
    expect(new Set([apiPort, webPort, workerPort]).size).toBe(3);
  });

  it("preserves a hand-edited command and target deploy", async () => {
    const root = await fixture();
    await adoptProject(root, { quiet: true });

    const edited = await readRaw(root);
    edited.commands = { ...(edited.commands ?? {}), lint: "my-special-linter" };
    edited.targets!.find((t) => t.name === "api")!.deploy = "custom-ship";
    await writeFile(path.join(root, "premo.json"), JSON.stringify(edited, null, 2));

    await syncProject(root);

    const after = await loadProject(root);
    expect(after.commands.lint).toBe("my-special-linter");
    expect(after.targets.find((t) => t.name === "api")!.deploy).toBe("custom-ship");
  });

  it("reports a package that's no longer detected as stale, without removing it", async () => {
    const root = await fixture();
    await adoptProject(root, { quiet: true });

    // Add a phantom package to the manifest that the repo doesn't back.
    const edited = await readRaw(root);
    edited.packages!.push({ name: "ghost", dirs: ["ghost/"] });
    await writeFile(path.join(root, "premo.json"), JSON.stringify(edited, null, 2));

    const r = await syncProject(root);
    expect(r.stale.packages).toContain("ghost");
    const after = await loadProject(root);
    expect(after.packages.map((p) => p.name)).toContain("ghost");
  });
});

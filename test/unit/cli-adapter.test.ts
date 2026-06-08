import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { cliAdapter } from "../../src/core/adapters/cli.js";
import { resolvePackages } from "../../src/core/packages.js";
import { adoptProject } from "../../src/core/context.js";
import { ProjectManifest } from "../../src/manifest/types.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-cli-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("cli adapter", () => {
  it("detects a bin (string and object forms) and exposes one command target", async () => {
    const strRoot = await tmp();
    await pkg(strRoot, { name: "tool", bin: "./dist/cli.js" });
    expect(await cliAdapter.detect(strRoot)).toBe(true);

    const objRoot = await tmp();
    await pkg(objRoot, { name: "tool", bin: { tool: "./dist/cli.js" } });
    expect(await cliAdapter.detect(objRoot)).toBe(true);

    const targets = await cliAdapter.packages(objRoot);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.kind).toBe("command");
    expect(targets[0]!.dirs).toEqual(["."]);
  });

  it("does not detect a package without a bin", async () => {
    const root = await tmp();
    await pkg(root, { name: "lib", scripts: { build: "tsc" } });
    expect(await cliAdapter.detect(root)).toBe(false);
  });

  it("maps build/test/lint to scripts", async () => {
    const root = await tmp();
    await pkg(root, {
      name: "tool",
      bin: "./dist/cli.js",
      scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
    });
    const [t] = await cliAdapter.packages(root);
    expect(await cliAdapter.command("build", t!, root)).toBe("yarn build");
    expect(await cliAdapter.command("test", t!, root)).toBe("yarn test");
    expect(await cliAdapter.command("lint", t!, root)).toBe("yarn lint");
  });

  it("resolves dev to `tsx <src>` when the TS source exists and tsx is a devDep", async () => {
    const root = await tmp();
    await pkg(root, {
      name: "premo",
      bin: { premo: "./dist/bin/premo.js" },
      devDependencies: { tsx: "^4" },
    });
    await mkdir(path.join(root, "bin"), { recursive: true });
    await writeFile(path.join(root, "bin/premo.ts"), "// entry");
    const [t] = await cliAdapter.packages(root);
    // tsx is resolved through the package manager (default yarn, quiet) so it's
    // found on PATH and stdout stays clean when premo shells the dev command out.
    expect(await cliAdapter.command("dev", t!, root)).toBe("yarn --silent tsx bin/premo.ts");
  });

  it("resolves tsx via npx when the project uses npm", async () => {
    const root = await tmp();
    await pkg(root, {
      name: "premo",
      bin: { premo: "./dist/bin/premo.js" },
      devDependencies: { tsx: "^4" },
    });
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await mkdir(path.join(root, "bin"), { recursive: true });
    await writeFile(path.join(root, "bin/premo.ts"), "// entry");
    const [t] = await cliAdapter.packages(root);
    expect(await cliAdapter.command("dev", t!, root)).toBe("npx tsx bin/premo.ts");
  });

  it("falls back to a dev/start script, then to `node <bin>`", async () => {
    const scriptRoot = await tmp();
    await pkg(scriptRoot, { name: "tool", bin: "./dist/cli.js", scripts: { start: "node ." } });
    const [st] = await cliAdapter.packages(scriptRoot);
    expect(await cliAdapter.command("dev", st!, scriptRoot)).toBe("yarn start");

    const bareRoot = await tmp();
    await pkg(bareRoot, { name: "tool", bin: "./dist/cli.js" });
    const [bt] = await cliAdapter.packages(bareRoot);
    expect(await cliAdapter.command("dev", bt!, bareRoot)).toBe("node dist/cli.js");
  });

  it("bakes deploy=npm publish only for a publishable package", async () => {
    const pubRoot = await tmp();
    await pkg(pubRoot, { name: "tool", bin: "./dist/cli.js" });
    expect((await cliAdapter.adopt!(pubRoot)).commands?.deploy).toBe("npm publish");

    const privRoot = await tmp();
    await pkg(privRoot, { name: "tool", bin: "./dist/cli.js", private: true });
    expect((await cliAdapter.adopt!(privRoot)).commands?.deploy).toBeUndefined();
  });

  it("is chosen over node-scripts for a bin package", async () => {
    const root = await tmp();
    await pkg(root, { name: "tool", bin: "./dist/cli.js", scripts: { build: "tsc" } });
    expect((await detectAdapter(root))?.name).toBe("cli");
  });

  it("yields to workspaces for a monorepo that also has a bin", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", bin: "./dist/cli.js", workspaces: ["app"] });
    await pkg(path.join(root, "app"), { name: "app", scripts: { build: "x" } });
    expect((await detectAdapter(root))?.name).toBe("workspaces");
  });

  it("carries kind 'command' through resolvePackages", async () => {
    const root = await tmp();
    await pkg(root, { name: "tool", bin: "./dist/cli.js", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({ name: "tool", adapter: "cli" });
    const targets = await resolvePackages(root, manifest);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.kind).toBe("command");
  });
});

describe("adoptProject for a cli project", () => {
  beforeAll(async () => {
    // Isolate the global port registry so the test never touches ~/.premo.
    process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-cli-"));
  });

  it("writes adapter:cli, bakes dev, and allocates NO port (command target)", async () => {
    const root = await tmp();
    await pkg(root, {
      name: "tool",
      bin: "./dist/cli.js",
      private: true,
      scripts: { build: "tsc" },
    });
    const manifest = await adoptProject(root, { quiet: true });
    expect(manifest.adapter).toBe("cli");
    expect(manifest.ports).toBeUndefined();
    expect(manifest.commands.dev).toBe("node dist/cli.js");
    expect(manifest.commands.deploy).toBeUndefined(); // private → not baked
  });
});

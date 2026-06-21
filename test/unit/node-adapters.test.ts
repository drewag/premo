import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { nodeScriptsAdapter } from "../../src/core/adapters/node-scripts.js";
import { workspacesAdapter } from "../../src/core/adapters/workspaces.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-adapter-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("node-scripts adapter", () => {
  it("detects a package.json and exposes one target with mapped commands", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc", dev: "next dev" } });

    expect(await nodeScriptsAdapter.detect(root)).toBe(true);
    const targets = await nodeScriptsAdapter.packages(root);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe("app");
    expect(targets[0]!.dirs).toEqual(["."]);
    // No lockfile ⇒ npm (the universal default).
    expect(await nodeScriptsAdapter.command("build", targets[0]!, root)).toBe("npm run build");
    expect(await nodeScriptsAdapter.command("dev", targets[0]!, root)).toBe("npm run dev");
    expect(await nodeScriptsAdapter.command("test", targets[0]!, root)).toBeNull();
  });

  it("uses npm when a package-lock.json is present", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    await writeFile(path.join(root, "package-lock.json"), "{}");
    const targets = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("build", targets[0]!, root)).toBe("npm run build");
  });

  it("uses yarn when a yarn.lock is present", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    await writeFile(path.join(root, "yarn.lock"), "");
    const targets = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("build", targets[0]!, root)).toBe("yarn build");
  });

  it("maps dev to the 'start' alias when there's no dev script", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { start: "node ." } });
    const targets = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("dev", targets[0]!, root)).toBe("npm run start");
  });

  it("forwards premo's port to a Vite dev server (yarn: no `--`)", async () => {
    const root = await tmp();
    await pkg(root, {
      name: "app",
      scripts: { dev: "vite", build: "vite build", test: "vitest run" },
    });
    await writeFile(path.join(root, "yarn.lock"), ""); // pin yarn to test its no-`--` form
    const [t] = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("dev", t!, root)).toBe(
      "yarn dev ${PORT:+--port $PORT}",
    );
    // not fooled by `vitest`, and build/test stay plain
    expect(await nodeScriptsAdapter.command("build", t!, root)).toBe("yarn build");
    expect(await nodeScriptsAdapter.command("test", t!, root)).toBe("yarn test");
  });

  it("uses npm's -- passthrough for the Vite port", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { dev: "vite" } });
    await writeFile(path.join(root, "package-lock.json"), "{}");
    const [t] = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("dev", t!, root)).toBe(
      "npm run dev -- ${PORT:+--port $PORT}",
    );
  });

  it("leaves non-Vite dev servers to use $PORT themselves", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { dev: "node server.js" } });
    const [t] = await nodeScriptsAdapter.packages(root);
    expect(await nodeScriptsAdapter.command("dev", t!, root)).toBe("npm run dev");
  });
});

describe("workspaces adapter", () => {
  it("expands workspace globs and literals into one target each", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", private: true, workspaces: ["packages/*", "app"] });
    await pkg(path.join(root, "packages/a"), { name: "a", scripts: { build: "echo a" } });
    await pkg(path.join(root, "packages/b"), { name: "b", scripts: { test: "echo b" } });
    await pkg(path.join(root, "app"), { name: "app", scripts: { dev: "serve" } });

    expect(await workspacesAdapter.detect(root)).toBe(true);
    const targets = await workspacesAdapter.packages(root);
    const byName = Object.fromEntries(targets.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["a", "app", "b"]);
    expect(byName.a!.dirs).toEqual(["packages/a/"]);
    expect(await workspacesAdapter.command("build", byName.a!, root)).toBe("npm run build");
    expect(await workspacesAdapter.command("build", byName.b!, root)).toBeNull();
  });

  it("detects a pnpm-workspace.yaml monorepo and uses pnpm for commands", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono" }); // no `workspaces` field
    await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    await writeFile(path.join(root, "pnpm-lock.yaml"), "");
    await pkg(path.join(root, "packages/x"), { name: "x", scripts: { build: "tsc" } });

    expect(await workspacesAdapter.detect(root)).toBe(true);
    const [t] = await workspacesAdapter.packages(root);
    expect(t!.name).toBe("x");
    expect(await workspacesAdapter.command("build", t!, root)).toBe("pnpm build");
    expect((await detectAdapter(root))?.name).toBe("workspaces");
  });

  it("is chosen over node-scripts when workspaces exist", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", workspaces: ["app"] });
    await pkg(path.join(root, "app"), { name: "app", scripts: { build: "x" } });
    const adapter = await detectAdapter(root);
    expect(adapter?.name).toBe("workspaces");
  });

  it("falls back to node-scripts for a plain package", async () => {
    const root = await tmp();
    await pkg(root, { name: "plain", scripts: { build: "x" } });
    const adapter = await detectAdapter(root);
    expect(adapter?.name).toBe("node-scripts");
  });
});

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { monorepoAdapter } from "../../src/core/adapters/monorepo.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-mono-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("monorepo adapter (manual, recursive depth-1)", () => {
  it("wins over cli for a repo with a root bin + ≥2 sub-projects", async () => {
    const root = await tmp();
    // A dev-tool bin + aggregator scripts at the root must NOT make this a `cli`.
    await pkg(root, { name: "mono", bin: "./bin/dev.ts", scripts: { build: "build-all" } });
    await pkg(path.join(root, "api"), { name: "api", scripts: { build: "tsc" } });
    await pkg(path.join(root, "web"), { name: "webpkg", scripts: { build: "vite build" } });

    expect(await monorepoAdapter.detect(root)).toBe(true);
    expect((await detectAdapter(root))?.name).toBe("monorepo");
  });

  it("keys packages by directory name, not package name", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", bin: "./x" });
    await pkg(path.join(root, "frontend"), { name: "web", scripts: { build: "x" } }); // name ≠ dir
    await pkg(path.join(root, "backend"), { name: "srv", scripts: { build: "x" } });

    const packages = await monorepoAdapter.packages(root);
    expect(packages.map((p) => p.name).sort()).toEqual(["backend", "frontend"]);
    const fe = packages.find((p) => p.name === "frontend")!;
    expect(fe.dirs).toEqual(["frontend/"]);
    expect(fe.cwd).toBe(path.join(root, "frontend"));
  });

  it("delegates verb resolution to each member's own leaf adapter", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", bin: "./x" });
    await pkg(path.join(root, "api"), { name: "api", scripts: { build: "tsc", test: "jest" } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { build: "vite build" } });

    const packages = await monorepoAdapter.packages(root);
    const api = packages.find((p) => p.name === "api")!;
    const web = packages.find((p) => p.name === "web")!;
    expect(await monorepoAdapter.command("build", api, root)).toBe("yarn build");
    expect(await monorepoAdapter.command("test", api, root)).toBe("yarn test");
    expect(await monorepoAdapter.command("test", web, root)).toBeNull(); // honest: web has no test
  });

  it("is polyglot — a node member and an xcode member coexist", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", bin: "./x" });
    await pkg(path.join(root, "api"), { name: "api", scripts: { build: "tsc" } });
    await mkdir(path.join(root, "ios", "App.xcodeproj"), { recursive: true });

    const packages = await monorepoAdapter.packages(root);
    expect(packages.map((p) => p.name).sort()).toEqual(["api", "ios"]);
    const ios = packages.find((p) => p.name === "ios")!;
    expect(await monorepoAdapter.command("build", ios, root)).toContain("xcodebuild");
  });

  it("needs ≥2 members — a single sub-project is not a monorepo", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", bin: "./x" }); // root has a bin
    await pkg(path.join(root, "only"), { name: "only", scripts: { build: "x" } });

    expect(await monorepoAdapter.detect(root)).toBe(false);
    expect((await detectAdapter(root))?.name).toBe("cli"); // falls back to the root bin
  });

  it("yields to a declared workspaces monorepo", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono", workspaces: ["a", "b"] });
    await pkg(path.join(root, "a"), { name: "a", scripts: { build: "x" } });
    await pkg(path.join(root, "b"), { name: "b", scripts: { build: "x" } });
    expect((await detectAdapter(root))?.name).toBe("workspaces");
  });

  it("ignores node_modules and dotfiles when scanning members", async () => {
    const root = await tmp();
    await pkg(root, { name: "mono" });
    await pkg(path.join(root, "node_modules", "dep"), { name: "dep" });
    await pkg(path.join(root, ".cache"), { name: "cache" });
    await pkg(path.join(root, "real"), { name: "real", scripts: { build: "x" } });
    // Only `real` is a member ⇒ below the ≥2 threshold ⇒ not a monorepo.
    expect(await monorepoAdapter.detect(root)).toBe(false);
    const packages = await monorepoAdapter.packages(root);
    expect(packages.map((p) => p.name)).toEqual(["real"]);
  });
});

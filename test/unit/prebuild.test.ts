import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectManifest } from "../../src/manifest/types.js";
import { resolvePackages, withPrebuild } from "../../src/core/packages.js";

// An empty tmp dir so no adapter detects (no package.json / .xcodeproj): the
// manifest's declared packages + commands drive resolution, isolating the
// prebuild-composition logic from any adapter.
async function emptyRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-prebuild-"));
}

describe("withPrebuild", () => {
  it("gates the verb command on the hook succeeding, keeping it in the same shell", () => {
    expect(withPrebuild("gen", "build it")).toBe("gen && {\nbuild it\n}");
  });

  it("preserves a multi-line command (e.g. an exec recipe) inside the brace group", () => {
    const cmd = "set -e\nexec ./app";
    expect(withPrebuild("xcodegen generate", cmd)).toBe(
      "xcodegen generate && {\nset -e\nexec ./app\n}",
    );
  });
});

describe("resolvePackages — prebuild composition", () => {
  it("prefixes dev/build/test (not lint/deploy) with a package's prebuild", async () => {
    const root = await emptyRoot();
    const manifest = ProjectManifest.parse({
      name: "app",
      packages: [
        {
          name: "app",
          commands: { dev: "run", build: "compile", test: "check", lint: "eslint", deploy: "ship" },
          prebuild: "gen",
        },
      ],
    });
    const [pkg] = await resolvePackages(root, manifest);
    expect(pkg!.commands.dev).toBe("gen && {\nrun\n}");
    expect(pkg!.commands.build).toBe("gen && {\ncompile\n}");
    expect(pkg!.commands.test).toBe("gen && {\ncheck\n}");
    // lint/deploy don't (re)build the project → never wrapped
    expect(pkg!.commands.lint).toBe("eslint");
    expect(pkg!.commands.deploy).toBe("ship");
  });

  it("a per-package prebuild wins over the project-level one", async () => {
    const root = await emptyRoot();
    const manifest = ProjectManifest.parse({
      name: "app",
      prebuild: "project-gen",
      packages: [{ name: "app", commands: { build: "compile" }, prebuild: "pkg-gen" }],
    });
    const [pkg] = await resolvePackages(root, manifest);
    expect(pkg!.commands.build).toBe("pkg-gen && {\ncompile\n}");
  });

  it("falls back to the project-level prebuild when a package declares none", async () => {
    const root = await emptyRoot();
    const manifest = ProjectManifest.parse({
      name: "app",
      prebuild: "project-gen",
      packages: [{ name: "app", commands: { build: "compile" } }],
    });
    const [pkg] = await resolvePackages(root, manifest);
    expect(pkg!.commands.build).toBe("project-gen && {\ncompile\n}");
  });

  it("applies a project-level prebuild to the implicit single package (no declared packages)", async () => {
    const root = await emptyRoot();
    const manifest = ProjectManifest.parse({
      name: "app",
      prebuild: "gen",
      commands: { build: "compile", lint: "eslint" },
    });
    const [pkg] = await resolvePackages(root, manifest);
    expect(pkg!.commands.build).toBe("gen && {\ncompile\n}");
    expect(pkg!.commands.lint).toBe("eslint");
  });

  it("leaves commands untouched when there is no prebuild", async () => {
    const root = await emptyRoot();
    const manifest = ProjectManifest.parse({
      name: "app",
      packages: [{ name: "app", commands: { build: "compile" } }],
    });
    const [pkg] = await resolvePackages(root, manifest);
    expect(pkg!.commands.build).toBe("compile");
  });
});

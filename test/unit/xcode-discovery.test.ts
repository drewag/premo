import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectGeneratorPrebuild,
  findXcodeProject,
  projectFlag,
  XCODEGEN_PREBUILD,
} from "../../src/core/xcode/discovery.js";

// Pure / fixture-on-disk parts of src/core/xcode/discovery.ts. No xcode binaries
// are invoked, so these run on a clean Linux CI.

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-discovery-"));
}

describe("findXcodeProject", () => {
  it("detects a bare .xcodeproj", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    expect(await findXcodeProject(root)).toEqual({
      kind: "project",
      path: "Awooga.xcodeproj",
      name: "Awooga",
    });
  });

  it("prefers a root .xcworkspace over a sibling .xcodeproj", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    await mkdir(path.join(root, "Awooga.xcworkspace"));
    expect(await findXcodeProject(root)).toEqual({
      kind: "workspace",
      path: "Awooga.xcworkspace",
      name: "Awooga",
    });
  });

  it("falls back to the generator spec name when no project is built", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "project.yml"), "name: Awooga\n");
    expect(await findXcodeProject(root)).toEqual({
      kind: "project",
      path: "Awooga.xcodeproj",
      name: "Awooga",
    });
  });

  it("prefers a built .xcodeproj over the spec name", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Built.xcodeproj"));
    await writeFile(path.join(root, "project.yml"), "name: FromSpec\n");
    expect((await findXcodeProject(root))!.name).toBe("Built");
  });

  it("reads a quoted top-level spec name and ignores nested name: keys", async () => {
    const root = await tmp();
    await writeFile(
      path.join(root, "project.yml"),
      'name: "My App"\ntargets:\n  Widget:\n    name: ShouldNotWin\n',
    );
    expect((await findXcodeProject(root))!.name).toBe("My App");
  });

  it("returns null when there's no project and no spec", async () => {
    const root = await tmp();
    expect(await findXcodeProject(root)).toBeNull();
  });

  it("returns null for an unreadable / missing root", async () => {
    expect(await findXcodeProject(path.join(await tmp(), "does-not-exist"))).toBeNull();
  });

  it("returns null when the spec has no parseable name", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "project.yml"), "options:\n  bundleIdPrefix: com.x\n");
    expect(await findXcodeProject(root)).toBeNull();
  });

  it("recognizes the project.yaml spec spelling too", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "project.yaml"), "name: Awooga\n");
    expect((await findXcodeProject(root))!.name).toBe("Awooga");
  });
});

describe("detectGeneratorPrebuild", () => {
  it("returns the xcodegen prebuild command when a spec is present", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "project.yml"), "name: Awooga\n");
    expect(await detectGeneratorPrebuild(root)).toBe(XCODEGEN_PREBUILD);
    expect(XCODEGEN_PREBUILD).toBe("xcodegen generate");
  });

  it("recognizes the project.yaml spelling", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "project.yaml"), "name: Awooga\n");
    expect(await detectGeneratorPrebuild(root)).toBe("xcodegen generate");
  });

  it("returns null with no spec on disk", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    expect(await detectGeneratorPrebuild(root)).toBeNull();
  });

  it("returns null for an unreadable / missing root", async () => {
    expect(await detectGeneratorPrebuild(path.join(await tmp(), "nope"))).toBeNull();
  });
});

describe("projectFlag", () => {
  it("emits -workspace for a workspace", () => {
    expect(projectFlag({ kind: "workspace", path: "App.xcworkspace", name: "App" })).toBe(
      "-workspace App.xcworkspace",
    );
  });

  it("emits -project for a project", () => {
    expect(projectFlag({ kind: "project", path: "App.xcodeproj", name: "App" })).toBe(
      "-project App.xcodeproj",
    );
  });

  it("shell-quotes a path with spaces", () => {
    expect(projectFlag({ kind: "project", path: "My App.xcodeproj", name: "My App" })).toBe(
      "-project 'My App.xcodeproj'",
    );
  });
});

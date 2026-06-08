import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePackages } from "../../src/core/packages.js";
import { ProjectManifest } from "../../src/manifest/types.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-packages-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}

describe("resolvePackages", () => {
  it("resolves adapter commands for a single package", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc", test: "vitest" } });
    const manifest = ProjectManifest.parse({ name: "app", adapter: "node-scripts" });

    const packages = await resolvePackages(root, manifest);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.commands.build).toBe("yarn build");
    expect(packages[0]!.commands.test).toBe("yarn test");
  });

  it("lets project-level commands override the adapter", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
    });
    const packages = await resolvePackages(root, manifest);
    expect(packages[0]!.commands.build).toBe("make build");
  });

  it("lets a per-package override beat the project default", async () => {
    const root = await tmp();
    await pkg(root, { name: "app", scripts: { build: "tsc" } });
    const manifest = ProjectManifest.parse({
      name: "app",
      adapter: "node-scripts",
      commands: { build: "make build" },
      packages: [{ name: "app", commands: { build: "bespoke" } }],
    });
    const packages = await resolvePackages(root, manifest);
    expect(packages[0]!.commands.build).toBe("bespoke");
  });

  it("synthesizes an implicit package from project commands when no adapter matches", async () => {
    const root = await tmp(); // empty dir, no package.json
    const manifest = ProjectManifest.parse({ name: "thing", commands: { build: "make" } });
    const packages = await resolvePackages(root, manifest);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.name).toBe("thing");
    expect(packages[0]!.commands.build).toBe("make");
  });

  it("derives build/test/dev live from a package's xcode block (DESIGN §13.2)", async () => {
    const root = await tmp();
    const manifest = ProjectManifest.parse({
      name: "mono",
      packages: [
        { name: "ios", dirs: ["ios/"], xcode: { project: "odo.xcodeproj", scheme: "odo" } },
      ],
    });
    const ios = (await resolvePackages(root, manifest)).find((p) => p.name === "ios")!;
    expect(ios.xcode?.scheme).toBe("odo");
    expect(ios.commands.build).toBe(
      'xcodebuild -project odo.xcodeproj -scheme odo -destination "$PREMO_XCODE_DEST" build',
    );
    expect(ios.commands.dev).toContain("PREMO_XCODE_BUNDLE_ID");
  });

  it("implies the xcode runner from a single-app top-level xcode block", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj")); // the xcode adapter detects the app
    const manifest = ProjectManifest.parse({
      name: "awooga",
      adapter: "xcode",
      xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" },
    });
    const app = (await resolvePackages(root, manifest)).find((p) => p.name === "awooga")!;
    // No commands baked into the manifest — they come from the implied runner,
    // using the resolved scheme (not a basename guess).
    expect(manifest.commands).toEqual({});
    expect(app.commands.build).toBe(
      'xcodebuild -project Awooga.xcodeproj -scheme Awooga -destination "$PREMO_XCODE_DEST" build',
    );
    expect(app.commands.test).toContain('-destination "$PREMO_XCODE_DEST" test');
    expect(app.commands.dev).toContain("PREMO_XCODE_BUNDLE_ID");
  });

  it("lets a literal command override the implied xcode runner per verb", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const manifest = ProjectManifest.parse({
      name: "awooga",
      adapter: "xcode",
      xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" },
      commands: { build: "make ios" }, // raw string wins; dev/test still implied
    });
    const app = (await resolvePackages(root, manifest)).find((p) => p.name === "awooga")!;
    expect(app.commands.build).toBe("make ios");
    expect(app.commands.dev).toContain("xcodebuild");
  });

  it("resolves an explicit { run: xcode } spec against the xcode block", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const manifest = ProjectManifest.parse({
      name: "awooga",
      adapter: "xcode",
      xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" },
      commands: { build: { run: "xcode" } },
    });
    const app = (await resolvePackages(root, manifest)).find((p) => p.name === "awooga")!;
    expect(app.commands.build).toBe(
      'xcodebuild -project Awooga.xcodeproj -scheme Awooga -destination "$PREMO_XCODE_DEST" build',
    );
  });
});

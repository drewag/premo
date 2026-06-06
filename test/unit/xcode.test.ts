import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";

import { ProjectManifest } from "../../src/manifest/types.js";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { xcodeAdapter } from "../../src/core/adapters/xcode.js";
import { readFile } from "node:fs/promises";
import {
  ensurePremoGitignore,
  readLastXcodeDest,
  writeLastXcodeDest,
} from "../../src/core/local.js";
import {
  findXcodeProject,
  listPhysicalDevices,
  resolveDestination,
  xcodeCommands,
  xcodeEnvFor,
} from "../../src/core/xcode.js";

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

const SIMCTL_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
      { name: "iPhone 17 Pro", udid: "UDID-IPHONE", state: "Shutdown" },
      { name: "iPad Pro", udid: "UDID-IPAD", state: "Booted" },
    ],
  },
});

const XCTRACE_OUTPUT = [
  "== Devices ==",
  "Andrew's iPhone (18.1) (00008120-001E445E0C11)",
  "My Mac (00006000-0001A0B23456)",
  "== Simulators ==",
  "iPhone 17 Pro Simulator (26.2) (UDID-IPHONE)",
].join("\n");

// Route mocked execa: simctl + xctrace return fixtures, everything else empty/ok.
function stubSimctl(json = SIMCTL_JSON, xctrace = ""): void {
  mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
    if (args?.[0] === "simctl") return { exitCode: 0, stdout: json };
    if (cmd === "xctrace") return { exitCode: 0, stdout: xctrace };
    return { exitCode: 0, stdout: "" };
  });
}

afterEach(() => mockExeca.mockReset());

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-xcode-"));
}

function xcodeManifest(extra: Record<string, unknown> = {}) {
  return ProjectManifest.parse({ name: "awoooga", adapter: "xcode", ...extra });
}

describe("findXcodeProject / adapter detection", () => {
  it("detects a .xcodeproj and prefers a root .xcworkspace", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    let proj = await findXcodeProject(root);
    expect(proj).toEqual({ kind: "project", path: "Awooga.xcodeproj", name: "Awooga" });

    await mkdir(path.join(root, "Awooga.xcworkspace"));
    proj = await findXcodeProject(root);
    expect(proj!.kind).toBe("workspace");
  });

  it("the xcode adapter wins over the node adapters", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Foo.xcodeproj"));
    expect(await xcodeAdapter.detect(root)).toBe(true);
    expect((await detectAdapter(root))?.name).toBe("xcode");
  });

  it("exposes one target rooted at the repo", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const targets = await xcodeAdapter.targets(root);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe("awooga");
    expect(targets[0]!.dirs).toEqual(["."]);
  });
});

describe("xcodeCommands / adapter.command", () => {
  it("threads the destination through PREMO_XCODE_DEST and bakes scheme", () => {
    const cmds = xcodeCommands("-project Awooga.xcodeproj", "Awooga");
    expect(cmds.build).toBe(
      'xcodebuild -project Awooga.xcodeproj -scheme Awooga -destination "$PREMO_XCODE_DEST" build',
    );
    expect(cmds.test).toContain('-destination "$PREMO_XCODE_DEST" test');
    expect(cmds.dev).toContain("PREMO_XCODE_BOOT_UDID");
    expect(cmds.dev).toContain("simctl launch --console-pty");
    expect(cmds.dev).toContain("devicectl device install");
    // Product path comes from build settings (destination-accurate), not `find`.
    expect(cmds.dev).toContain("-showBuildSettings");
    expect(cmds.dev).not.toContain("find ");
    // Build verbosity is controlled by the injected $PREMO_XCODE_QUIET.
    expect(cmds.dev).toContain("$PREMO_XCODE_QUIET build");
  });

  it("only offers lint when a .swiftlint.yml exists; never a deploy default", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const [t] = await xcodeAdapter.targets(root);
    expect(await xcodeAdapter.command("lint", t!, root)).toBeNull();
    expect(await xcodeAdapter.command("deploy", t!, root)).toBeNull();
    expect(await xcodeAdapter.command("build", t!, root)).toContain("xcodebuild");

    await writeFile(path.join(root, ".swiftlint.yml"), "");
    expect(await xcodeAdapter.command("lint", t!, root)).toBe("swiftlint");
  });
});

describe("resolveDestination", () => {
  it("matches a --device by name substring", async () => {
    stubSimctl();
    const d = await resolveDestination({
      manifest: xcodeManifest(),
      flagDevice: "17 pro",
      interactive: false,
    });
    expect(d.dest).toBe("platform=iOS Simulator,id=UDID-IPHONE");
    expect(d.bootUdid).toBe("UDID-IPHONE");
  });

  it("throws a helpful error when --device matches nothing", async () => {
    stubSimctl();
    await expect(
      resolveDestination({ manifest: xcodeManifest(), flagDevice: "pixel", interactive: false }),
    ).rejects.toThrow(/No device or simulator matching "pixel"/);
  });

  it("matches a connected physical device by --device name", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const d = await resolveDestination({
      manifest: xcodeManifest(),
      flagDevice: "andrew's iphone",
      interactive: false,
    });
    expect(d.dest).toBe("id=00008120-001E445E0C11");
    expect(d.deviceUdid).toBe("00008120-001E445E0C11");
  });

  it("--platform ios-device prefers a connected device over simulators", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const d = await resolveDestination({
      manifest: xcodeManifest(),
      flagPlatform: "ios-device",
      interactive: false,
    });
    expect(d.deviceUdid).toBe("00008120-001E445E0C11");
  });

  it("maps --platform macos to the Mac destination", async () => {
    stubSimctl();
    const d = await resolveDestination({
      manifest: xcodeManifest(),
      flagPlatform: "macos",
      interactive: false,
    });
    expect(d.dest).toBe("platform=macOS");
  });

  it("uses the configured default when non-interactive", async () => {
    stubSimctl();
    const manifest = xcodeManifest({
      xcode: {
        project: "Awooga.xcodeproj",
        scheme: "Awooga",
        defaultDestination: { platform: "ios-simulator", deviceName: "iPhone 17 Pro", os: "26.2" },
      },
    });
    const d = await resolveDestination({ manifest, interactive: false });
    expect(d.dest).toBe("platform=iOS Simulator,id=UDID-IPHONE");
  });

  it("errors when non-interactive with no flag and no configured default", async () => {
    stubSimctl();
    await expect(
      resolveDestination({ manifest: xcodeManifest(), interactive: false }),
    ).rejects.toThrow(/No destination to run on/);
  });
});

describe("listPhysicalDevices", () => {
  it("parses connected devices and skips My Mac and the simulators section", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const devices = await listPhysicalDevices();
    expect(devices).toEqual([
      {
        label: "Andrew's iPhone (18.1)",
        dest: "id=00008120-001E445E0C11",
        deviceUdid: "00008120-001E445E0C11",
      },
    ]);
  });
});

describe("xcodeEnvFor", () => {
  it("is a no-op for non-xcode projects", async () => {
    const manifest = ProjectManifest.parse({ name: "node-app" });
    expect(await xcodeEnvFor(manifest, { interactive: false })).toEqual({});
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("exports PREMO_XCODE_* for an xcode project", async () => {
    stubSimctl();
    const manifest = xcodeManifest({
      xcode: {
        project: "Awooga.xcodeproj",
        scheme: "Awooga",
        bundleId: "drewag.Awooga",
        defaultDestination: { platform: "ios-simulator", deviceName: "iPhone 17 Pro", os: "26.2" },
      },
    });
    const env = await xcodeEnvFor(manifest, { interactive: false });
    expect(env.PREMO_XCODE_DEST).toBe("platform=iOS Simulator,id=UDID-IPHONE");
    expect(env.PREMO_XCODE_BOOT_UDID).toBe("UDID-IPHONE");
    expect(env.PREMO_XCODE_BUNDLE_ID).toBe("drewag.Awooga");
    expect(env.PREMO_XCODE_DEVICE_UDID).toBeUndefined();
  });

  it("quiets the build by default and unquiets it with verbose", async () => {
    stubSimctl();
    const manifest = xcodeManifest({
      xcode: {
        project: "Awooga.xcodeproj",
        scheme: "Awooga",
        defaultDestination: { platform: "ios-simulator", deviceName: "iPhone 17 Pro", os: "26.2" },
      },
    });
    expect((await xcodeEnvFor(manifest, { interactive: false })).PREMO_XCODE_QUIET).toBe("-quiet");
    expect(
      (await xcodeEnvFor(manifest, { interactive: false, verbose: true })).PREMO_XCODE_QUIET,
    ).toBe("");
  });

  it("exports PREMO_XCODE_DEVICE_UDID (not BOOT_UDID) for a physical device", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const manifest = xcodeManifest({ xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" } });
    const env = await xcodeEnvFor(manifest, { device: "andrew's iphone", interactive: false });
    expect(env.PREMO_XCODE_DEVICE_UDID).toBe("00008120-001E445E0C11");
    expect(env.PREMO_XCODE_BOOT_UDID).toBeUndefined();
  });
});

describe("last-destination memory", () => {
  const IPHONE = "platform=iOS Simulator,id=UDID-IPHONE";
  const IPAD = "platform=iOS Simulator,id=UDID-IPAD";

  // configured default = iPad; last run = iPhone. (iPad is also the booted sim,
  // so this proves the memory wins over both the config default and "booted".)
  const cfgIpad = {
    project: "Awooga.xcodeproj",
    scheme: "Awooga",
    defaultDestination: { platform: "ios-simulator", deviceName: "iPad Pro", os: "26.2" },
  };

  it("round-trips the last destination through .premo-local.json", async () => {
    const root = await tmp();
    expect(await readLastXcodeDest(root)).toBeUndefined();
    await writeLastXcodeDest(root, {
      dest: IPHONE,
      label: "iPhone 17 Pro",
      bootUdid: "UDID-IPHONE",
    });
    expect(await readLastXcodeDest(root)).toMatchObject({ dest: IPHONE, bootUdid: "UDID-IPHONE" });
  });

  it("defaults the picker to the last-run destination over the config default", async () => {
    stubSimctl();
    const root = await tmp();
    await writeLastXcodeDest(root, { dest: IPHONE, label: "iPhone 17 Pro" });
    const d = await resolveDestination({
      manifest: xcodeManifest({ xcode: cfgIpad }),
      interactive: true,
      root,
    });
    expect(d.dest).toBe(IPHONE);
  });

  it("falls back to the config default when the remembered device is gone", async () => {
    stubSimctl();
    const root = await tmp();
    await writeLastXcodeDest(root, { dest: "platform=iOS Simulator,id=GONE", label: "Old" });
    const d = await resolveDestination({
      manifest: xcodeManifest({ xcode: cfgIpad }),
      interactive: true,
      root,
    });
    expect(d.dest).toBe(IPAD);
  });

  it("remembers the destination after a run, only when asked", async () => {
    stubSimctl();
    const manifest = xcodeManifest({ xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" } });

    const noRemember = await tmp();
    await xcodeEnvFor(manifest, { device: "17 pro", interactive: false, root: noRemember });
    expect(await readLastXcodeDest(noRemember)).toBeUndefined();

    const remembered = await tmp();
    await xcodeEnvFor(manifest, {
      device: "17 pro",
      interactive: false,
      root: remembered,
      remember: true,
    });
    expect(await readLastXcodeDest(remembered)).toMatchObject({ dest: IPHONE });
  });
});

describe("ensurePremoGitignore", () => {
  it("adds premo-local paths once, idempotently, preserving existing entries", async () => {
    const root = await tmp();
    await writeFile(path.join(root, ".gitignore"), "node_modules\n");

    await ensurePremoGitignore(root);
    const after = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(after).toContain("node_modules");
    expect(after).toContain(".premo-local.json");
    expect(after).toContain(".premo/");
    expect(after).toContain(".runtime/");

    await ensurePremoGitignore(root); // no-op the second time
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(after);
  });
});

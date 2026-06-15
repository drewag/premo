import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";

// Mirror the real (non-TTY) selector: return whatever index was preselected, so
// tests can assert *whether* the picker was reached without driving keypresses.
vi.mock("../../src/core/select.js", () => ({
  selectFromList: vi.fn(
    async (_items: string[], opts?: { defaultIndex?: number }) => opts?.defaultIndex ?? 0,
  ),
}));
import { selectFromList } from "../../src/core/select.js";
const mockSelect = selectFromList as unknown as ReturnType<typeof vi.fn>;

import { ProjectManifest, type XcodeConfig } from "../../src/manifest/types.js";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { xcodeAdapter } from "../../src/core/adapters/xcode.js";
import { monorepoAdapter } from "../../src/core/adapters/monorepo.js";
import { readFile } from "node:fs/promises";
import {
  ensurePremoGitignore,
  readLastXcodeDest,
  writeLastXcodeDest,
} from "../../src/core/local.js";
import {
  findXcodeProject,
  isDeviceLockedError,
  listPhysicalDevices,
  resolveDestination,
  xcodeCommands,
  xcodeEnvFor,
} from "../../src/core/xcode.js";
import { isEnvironmentSplit, deriveEnvNames } from "../../src/core/adapters/xcode.js";

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

afterEach(() => {
  mockExeca.mockReset();
  mockSelect.mockClear();
});

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

  it("exposes one package rooted at the repo", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const targets = await xcodeAdapter.packages(root);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe("awooga");
    expect(targets[0]!.dirs).toEqual(["."]);
  });
});

describe("xcodeCommands / adapter.command", () => {
  it("threads the destination and scheme through PREMO_XCODE_DEST / PREMO_XCODE_SCHEME", () => {
    const cmds = xcodeCommands("-project Awooga.xcodeproj");
    expect(cmds.build).toBe(
      'xcodebuild -project Awooga.xcodeproj -scheme "$PREMO_XCODE_SCHEME" -destination "$PREMO_XCODE_DEST" build',
    );
    expect(cmds.test).toContain('-destination "$PREMO_XCODE_DEST" test');
    expect(cmds.dev).toContain("PREMO_XCODE_BOOT_UDID");
    expect(cmds.dev).toContain("simctl launch --console-pty");
    expect(cmds.dev).toContain("devicectl device install");
    // macOS execs the .app binary directly so it's a killable child of dev (not
    // handed to launchd via `open`, which leaks the process and refocuses on
    // restart instead of relaunching the fresh build).
    expect(cmds.dev).toContain('exec "$TBD/$EP"');
    expect(cmds.dev).not.toContain("open -W");
    // Product path comes from build settings (destination-accurate), not `find`.
    expect(cmds.dev).toContain("-showBuildSettings");
    expect(cmds.dev).not.toContain("find ");
    // Build verbosity is controlled by the injected $PREMO_XCODE_QUIET.
    expect(cmds.dev).toContain("$PREMO_XCODE_QUIET build");
    // Bundle id for launch falls back to the build settings' PRODUCT_BUNDLE_IDENTIFIER
    // when no baked PREMO_XCODE_BUNDLE_ID is present (a not-yet-adopted app).
    expect(cmds.dev).toContain('BID="${PREMO_XCODE_BUNDLE_ID:-');
    expect(cmds.dev).toContain("PRODUCT_BUNDLE_IDENTIFIER");
    expect(cmds.dev).toContain('simctl launch --console-pty "$PREMO_XCODE_BOOT_UDID" "$BID"');
  });

  it("only offers lint when a .swiftlint.yml exists; never a deploy default", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "Awooga.xcodeproj"));
    const [t] = await xcodeAdapter.packages(root);
    // A detected app carries a best-effort xcode block (no adopt needed) so
    // destination resolution can engage on first verb run.
    expect(t!.xcode).toEqual({ project: "Awooga.xcodeproj", scheme: "Awooga" });
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
      xcode: undefined,
      flagDevice: "17 pro",
      interactive: false,
    });
    expect(d.dest).toBe("platform=iOS Simulator,id=UDID-IPHONE");
    expect(d.bootUdid).toBe("UDID-IPHONE");
  });

  it("throws a helpful error when --device matches nothing", async () => {
    stubSimctl();
    await expect(
      resolveDestination({ xcode: undefined, flagDevice: "pixel", interactive: false }),
    ).rejects.toThrow(/No device or simulator matching "pixel"/);
  });

  it("matches a connected physical device by --device name", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const d = await resolveDestination({
      xcode: undefined,
      flagDevice: "andrew's iphone",
      interactive: false,
    });
    expect(d.dest).toBe("id=00008120-001E445E0C11");
    expect(d.deviceUdid).toBe("00008120-001E445E0C11");
  });

  it("--platform ios-device prefers a connected device over simulators", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const d = await resolveDestination({
      xcode: undefined,
      flagPlatform: "ios-device",
      interactive: false,
    });
    expect(d.deviceUdid).toBe("00008120-001E445E0C11");
  });

  it("maps --platform macos to the Mac destination", async () => {
    stubSimctl();
    const d = await resolveDestination({
      xcode: undefined,
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
    const d = await resolveDestination({ xcode: manifest.xcode, interactive: false });
    expect(d.dest).toBe("platform=iOS Simulator,id=UDID-IPHONE");
  });

  it("errors when non-interactive with no flag and no configured default", async () => {
    stubSimctl();
    await expect(resolveDestination({ xcode: undefined, interactive: false })).rejects.toThrow(
      /No destination to run on/,
    );
  });
});

describe("monorepo per-package xcode (adopt)", () => {
  it("bakes an xcode block onto a native-app member", async () => {
    stubSimctl(); // xcodebuild -list/-showBuildSettings → empty (scheme falls back to project name)
    const root = await tmp();
    await mkdir(path.join(root, "ios", "App.xcodeproj"), { recursive: true });

    const baked = await monorepoAdapter.adopt!(root);
    expect(baked.packages).toHaveLength(1);
    expect(baked.packages![0]).toMatchObject({
      name: "ios",
      xcode: { project: "App.xcodeproj", scheme: "App" },
    });
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
    expect(await xcodeEnvFor(manifest.xcode, { interactive: false })).toEqual({});
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
    const env = await xcodeEnvFor(manifest.xcode, { interactive: false });
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
    expect((await xcodeEnvFor(manifest.xcode, { interactive: false })).PREMO_XCODE_QUIET).toBe(
      "-quiet",
    );
    expect(
      (await xcodeEnvFor(manifest.xcode, { interactive: false, verbose: true })).PREMO_XCODE_QUIET,
    ).toBe("");
  });

  it("exports PREMO_XCODE_DEVICE_UDID (not BOOT_UDID) for a physical device", async () => {
    stubSimctl(SIMCTL_JSON, XCTRACE_OUTPUT);
    const manifest = xcodeManifest({ xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" } });
    const env = await xcodeEnvFor(manifest.xcode, {
      device: "andrew's iphone",
      interactive: false,
    });
    expect(env.PREMO_XCODE_DEVICE_UDID).toBe("00008120-001E445E0C11");
    expect(env.PREMO_XCODE_BOOT_UDID).toBeUndefined();
  });
});

describe("last-destination memory", () => {
  const IPHONE = "platform=iOS Simulator,id=UDID-IPHONE";
  const IPAD = "platform=iOS Simulator,id=UDID-IPAD";

  // configured default = iPad; last run = iPhone. (iPad is also the booted sim,
  // so this proves the memory wins over both the config default and "booted".)
  const cfgIpad: XcodeConfig = {
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

  it("reuses the last-run destination without prompting (over the config default)", async () => {
    stubSimctl();
    const root = await tmp();
    await writeLastXcodeDest(root, { dest: IPHONE, label: "iPhone 17 Pro" });
    const d = await resolveDestination({
      xcode: cfgIpad,
      interactive: true,
      root,
    });
    expect(d.dest).toBe(IPHONE);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("re-prompts when --pick is set, even with a last-used destination", async () => {
    stubSimctl();
    const root = await tmp();
    await writeLastXcodeDest(root, { dest: IPHONE, label: "iPhone 17 Pro" });
    await resolveDestination({
      xcode: cfgIpad,
      interactive: true,
      root,
      pick: true,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("falls back to the picker when the remembered device is gone", async () => {
    stubSimctl();
    const root = await tmp();
    await writeLastXcodeDest(root, { dest: "platform=iOS Simulator,id=GONE", label: "Old" });
    const d = await resolveDestination({
      xcode: cfgIpad,
      interactive: true,
      root,
    });
    expect(d.dest).toBe(IPAD);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("remembers the destination after a run, only when asked", async () => {
    stubSimctl();
    const manifest = xcodeManifest({ xcode: { project: "Awooga.xcodeproj", scheme: "Awooga" } });

    const noRemember = await tmp();
    await xcodeEnvFor(manifest.xcode, { device: "17 pro", interactive: false, root: noRemember });
    expect(await readLastXcodeDest(noRemember)).toBeUndefined();

    const remembered = await tmp();
    await xcodeEnvFor(manifest.xcode, {
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

describe("isDeviceLockedError", () => {
  it("matches the devicectl locked-device phrasings", () => {
    const samples = [
      "ERROR: The operation couldn't be completed. The device is locked.",
      "Unable to launch app because the device was locked.",
      "...because the device was not, or could not be, unlocked.",
      "Please unlock iPhone to continue.",
      "Unlock the device and try again.",
      "Unlock your iPhone to continue installation.",
    ];
    for (const s of samples) expect(isDeviceLockedError(s)).toBe(true);
  });

  it("does not fire on ordinary build/app output", () => {
    const samples = [
      "** BUILD SUCCEEDED **",
      "Installing app on device…",
      "AppDelegate: user unlocked a premium feature",
      "warning: 'foo' is deprecated",
    ];
    for (const s of samples) expect(isDeviceLockedError(s)).toBe(false);
  });
});

describe("isEnvironmentSplit — only true dev/prod variants seed the env axis", () => {
  it("treats env-token variants of a shared base as an environment split", () => {
    expect(isEnvironmentSplit(["Chess Dev", "Chess Prod"])).toBe(true);
    expect(isEnvironmentSplit(["MyApp-Debug", "MyApp-Release"])).toBe(true);
    expect(isEnvironmentSplit(["App Dev", "App Staging", "App Prod"])).toBe(true);
    // env names map to short tokens
    expect([...deriveEnvNames(["Chess Dev", "Chess Prod"]).values()]).toEqual(["dev", "prod"]);
  });

  it("does NOT treat distinct products / extensions as environments", () => {
    // app + widget extension (glade) — "" / "controls", neither an env token
    expect(isEnvironmentSplit(["Glade", "GladeControls"])).toBe(false);
    // app + API product (finances) — no shared prefix, neither an env token
    expect(isEnvironmentSplit(["finances", "api"])).toBe(false);
    // app + test scheme
    expect(isEnvironmentSplit(["Thing", "ThingTests"])).toBe(false);
  });

  it("is false for zero or one scheme (the unnamed-environment case)", () => {
    expect(isEnvironmentSplit([])).toBe(false);
    expect(isEnvironmentSplit(["OnlyScheme"])).toBe(false);
  });
});

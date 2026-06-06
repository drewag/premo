import { execa } from "execa";
import { readdir } from "node:fs/promises";
import pc from "picocolors";
import type { ProjectManifest, XcodeDestination } from "../manifest/types.js";
import { selectFromList } from "./select.js";
import { shq } from "./shell.js";
import { readLastXcodeDest, writeLastXcodeDest } from "./local.js";

// --- locating the project/workspace --------------------------------------

export interface XcodeProject {
  kind: "workspace" | "project";
  path: string; // basename relative to root, e.g. "Awooga.xcodeproj"
  name: string; // without extension, e.g. "Awooga"
}

function pick(entries: string[]): XcodeProject | null {
  // A workspace, when present at the root, is xcodebuild's entry point (it wraps
  // the project — CocoaPods/SPM workspaces). The .xcworkspace *inside* an
  // .xcodeproj never appears at the root, so a root-level match is the real one.
  const ws = entries.find((e) => e.endsWith(".xcworkspace"));
  if (ws) return { kind: "workspace", path: ws, name: ws.replace(/\.xcworkspace$/, "") };
  const proj = entries.find((e) => e.endsWith(".xcodeproj"));
  if (proj) return { kind: "project", path: proj, name: proj.replace(/\.xcodeproj$/, "") };
  return null;
}

export async function findXcodeProject(root: string): Promise<XcodeProject | null> {
  try {
    return pick(await readdir(root));
  } catch {
    return null;
  }
}

// The `-workspace X` / `-project X` flag pair for xcodebuild invocations.
export function projectFlag(p: XcodeProject): string {
  return `${p.kind === "workspace" ? "-workspace" : "-project"} ${shq(p.path)}`;
}

// --- adopt-time inspection (runs xcodebuild; slow, called once) ----------

interface ListOutput {
  workspace?: { schemes?: string[] };
  project?: { schemes?: string[] };
}

export async function listSchemes(root: string, p: XcodeProject): Promise<string[]> {
  const flag = p.kind === "workspace" ? ["-workspace", p.path] : ["-project", p.path];
  const res = await execa("xcodebuild", ["-list", "-json", ...flag], { cwd: root, reject: false });
  if (res.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as ListOutput;
    return parsed.workspace?.schemes ?? parsed.project?.schemes ?? [];
  } catch {
    return [];
  }
}

// PRODUCT_BUNDLE_IDENTIFIER + SUPPORTED_PLATFORMS for a scheme, parsed from the
// (verbose but stable) text output of -showBuildSettings.
export async function buildSettings(
  root: string,
  p: XcodeProject,
  scheme: string,
): Promise<{ bundleId?: string; platforms: string[] }> {
  const flag = p.kind === "workspace" ? ["-workspace", p.path] : ["-project", p.path];
  const res = await execa("xcodebuild", ["-showBuildSettings", ...flag, "-scheme", scheme], {
    cwd: root,
    reject: false,
  });
  const bundleId = res.stdout.match(/^\s*PRODUCT_BUNDLE_IDENTIFIER = (.+)$/m)?.[1]?.trim();
  const platforms = (res.stdout.match(/^\s*SUPPORTED_PLATFORMS = (.+)$/m)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { bundleId, platforms };
}

// The default destination premo pins at adopt time: a real, installed simulator
// for the project's primary platform, falling back to macOS for Mac-only apps.
export async function pickDefaultDestination(
  platforms: string[],
): Promise<XcodeDestination | undefined> {
  const wantsIos = platforms.includes("iphonesimulator") || platforms.includes("iphoneos");
  const wantsVision = platforms.includes("xrsimulator") || platforms.includes("xros");
  if (wantsIos || wantsVision) {
    const sims = await listSimulators();
    const platform = wantsIos ? "ios-simulator" : "visionos-simulator";
    const family = wantsIos ? "iOS" : "visionOS";
    const match = sims.find((s) => s.os.startsWith(family));
    // Store the bare version ("26.2"), not the family-prefixed "iOS 26.2".
    if (match) return { platform, deviceName: match.name, os: match.os.replace(/^\S+\s+/, "") };
  }
  if (platforms.includes("macosx")) return { platform: "macos" };
  return undefined;
}

// --- the baked verb commands ---------------------------------------------

// build/test/dev as shell strings. Project + scheme are stable (baked here); only
// the destination varies per run, threaded in as PREMO_XCODE_DEST. dev also reads
// PREMO_XCODE_BUNDLE_ID and routes on the destination kind: a physical device
// (PREMO_XCODE_DEVICE_UDID) installs/launches via devicectl, a simulator
// (PREMO_XCODE_BOOT_UDID) via simctl, and macOS just opens the built .app.
export function xcodeCommands(
  flag: string,
  scheme: string,
): { dev: string; build: string; test: string } {
  const base = `xcodebuild ${flag} -scheme ${shq(scheme)}`;
  const built = `${base} -configuration Debug -destination "$PREMO_XCODE_DEST" -derivedDataPath "$DD"`;
  const dev = [
    `set -e`,
    `DD=.premo/xcode-dd`,
    // Quiet by default ($PREMO_XCODE_QUIET = -quiet): only warnings/errors during
    // the build, then the running app's logs stream as usual. `dev -v` clears it.
    `if [ -n "$PREMO_XCODE_QUIET" ]; then echo "▸ Building… (pass -v for full xcodebuild logs)"; fi`,
    `${built} $PREMO_XCODE_QUIET build`,
    // Resolve the exact product for THIS destination from build settings, so a
    // stale simulator build is never installed on a device (or vice-versa) —
    // both can coexist under Build/Products as Debug-iphone{simulator,os}.
    `S=$(${built} -showBuildSettings 2>/dev/null)`,
    `TBD=$(printf '%s\\n' "$S" | sed -n 's/^ *TARGET_BUILD_DIR = //p' | head -1)`,
    `WN=$(printf '%s\\n' "$S" | sed -n 's/^ *WRAPPER_NAME = //p' | head -1)`,
    `APP="$TBD/$WN"`,
    `if [ ! -d "$APP" ]; then echo "premo: no built .app for this destination ($APP)" >&2; exit 1; fi`,
    `if [ -n "$PREMO_XCODE_DEVICE_UDID" ]; then`,
    `  xcrun devicectl device install app --device "$PREMO_XCODE_DEVICE_UDID" "$APP"`,
    `  exec xcrun devicectl device process launch --console --terminate-existing --device "$PREMO_XCODE_DEVICE_UDID" "$PREMO_XCODE_BUNDLE_ID"`,
    `elif [ -n "$PREMO_XCODE_BOOT_UDID" ]; then`,
    `  xcrun simctl boot "$PREMO_XCODE_BOOT_UDID" 2>/dev/null || true`,
    `  open -a Simulator || true`,
    `  xcrun simctl install "$PREMO_XCODE_BOOT_UDID" "$APP"`,
    `  exec xcrun simctl launch --console-pty "$PREMO_XCODE_BOOT_UDID" "$PREMO_XCODE_BUNDLE_ID"`,
    `else`,
    `  exec open -W "$APP"`,
    `fi`,
  ].join("\n");
  return {
    dev,
    build: `${base} -destination "$PREMO_XCODE_DEST" build`,
    test: `${base} -destination "$PREMO_XCODE_DEST" test`,
  };
}

// --- destination resolution (runtime) ------------------------------------

export interface Simulator {
  name: string;
  udid: string;
  os: string; // e.g. "iOS 26.2"
  platform: string; // xcodebuild platform, e.g. "iOS Simulator"
  booted: boolean;
}

interface SimctlList {
  devices: Record<string, Array<{ name: string; udid: string; state: string }>>;
}

// "com.apple.CoreSimulator.SimRuntime.iOS-26-2" → { family:"iOS", os:"iOS 26.2" }
function parseRuntime(key: string): { family: string; os: string } | null {
  const tail = key.split("SimRuntime.")[1];
  if (!tail) return null;
  const dash = tail.indexOf("-");
  if (dash < 0) return null;
  const raw = tail.slice(0, dash);
  const version = tail.slice(dash + 1).replace(/-/g, ".");
  const family = raw === "xrOS" ? "visionOS" : raw; // iOS, watchOS, tvOS, visionOS
  return { family, os: `${family} ${version}` };
}

export async function listSimulators(): Promise<Simulator[]> {
  const res = await execa("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    reject: false,
  });
  if (res.exitCode !== 0) return [];
  let parsed: SimctlList;
  try {
    parsed = JSON.parse(res.stdout) as SimctlList;
  } catch {
    return [];
  }
  const out: Simulator[] = [];
  for (const [key, devs] of Object.entries(parsed.devices)) {
    const rt = parseRuntime(key);
    if (!rt) continue;
    const platform = `${rt.family} Simulator`;
    for (const d of devs) {
      out.push({
        name: d.name,
        udid: d.udid,
        os: rt.os,
        platform,
        booted: d.state === "Booted",
      });
    }
  }
  return out;
}

export interface Destination {
  label: string;
  dest: string; // xcodebuild -destination value
  bootUdid?: string; // simulator to boot (sim only)
  deviceUdid?: string; // physical device to install/launch on (device only)
}

function simDestination(s: Simulator): Destination {
  return {
    label: `${s.name} (${s.os})${s.booted ? " — booted" : ""}`,
    dest: `platform=${s.platform},id=${s.udid}`,
    bootUdid: s.udid,
  };
}

const MAC_DESTINATION: Destination = { label: "My Mac (macOS)", dest: "platform=macOS" };

const PLATFORM_FAMILY: Record<XcodeDestination["platform"], string> = {
  "ios-simulator": "iOS",
  "ios-device": "iOS",
  macos: "macOS",
  "visionos-simulator": "visionOS",
};

// Connected physical devices (iPhone/iPad/…), parsed from `xctrace list devices`.
// "My Mac" appears there too but has no OS-version group, so the two-group regex
// skips it (it's offered separately as MAC_DESTINATION). Best-effort: returns []
// if xctrace is unavailable or nothing is plugged in.
export async function listPhysicalDevices(): Promise<Destination[]> {
  const res = await execa("xctrace", ["list", "devices"], { reject: false });
  const text = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const out: Destination[] = [];
  let inDevices = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("==")) {
      inDevices = trimmed === "== Devices ==";
      continue;
    }
    if (!inDevices) continue;
    // "Andrew's iPhone (18.1) (00008120-001E…)" → name, os version, udid
    const m = line.match(/^(.+?) \(([0-9.]+)\) \(([0-9A-Fa-f-]{8,})\)\s*$/);
    if (!m) continue;
    out.push({ label: `${m[1]} (${m[2]})`, dest: `id=${m[3]}`, deviceUdid: m[3] });
  }
  return out;
}

// The full menu of run destinations. Physical devices come first (there are few,
// and they're usually what you want), then My Mac, then simulators (booted first).
function toMenu(sims: Simulator[], devices: Destination[] = []): Destination[] {
  const sorted = [...sims].sort((a, b) =>
    a.booted === b.booted ? a.name.localeCompare(b.name) : a.booted ? -1 : 1,
  );
  return [...devices, MAC_DESTINATION, ...sorted.map(simDestination)];
}

function configToDestination(cfg: XcodeDestination, sims: Simulator[]): Destination | null {
  if (cfg.platform === "macos") return MAC_DESTINATION;
  const family = PLATFORM_FAMILY[cfg.platform];
  const match = sims.find(
    (s) =>
      s.os.startsWith(family) &&
      (!cfg.deviceName || s.name === cfg.deviceName) &&
      (!cfg.os || s.os === `${family} ${cfg.os}` || s.os === cfg.os),
  );
  return match ? simDestination(match) : null;
}

export interface ResolveOptions {
  manifest: ProjectManifest;
  flagDevice?: string; // --device: simulator name or udid substring
  flagPlatform?: string; // --platform: ios|macos|visionos|…
  interactive: boolean; // prompt when no flag and attached to a TTY
  root?: string; // project root, for reading the remembered last destination
}

// Resolve which destination to build/run for. Precedence:
//   --device/--platform flag  →  configured default  →  interactive pick  →  error.
export async function resolveDestination(opts: ResolveOptions): Promise<Destination> {
  const cfg = opts.manifest.xcode?.defaultDestination;

  // 1. explicit flag
  if (opts.flagDevice || opts.flagPlatform) {
    const plat = (opts.flagPlatform ?? "").toLowerCase();
    if (/^mac/.test(plat)) return MAC_DESTINATION;
    const [sims, devices] = await Promise.all([listSimulators(), listPhysicalDevices()]);

    const needle = (opts.flagDevice ?? "").toLowerCase();
    if (needle) {
      const dev = devices.find(
        (d) => d.deviceUdid === opts.flagDevice || d.label.toLowerCase().includes(needle),
      );
      if (dev) return dev;
      const sim = sims.find(
        (s) => s.udid === opts.flagDevice || s.name.toLowerCase().includes(needle),
      );
      if (sim) return simDestination(sim);
      throw new Error(
        `No device or simulator matching "${opts.flagDevice}". ` +
          `Simulators: ${sims.map((s) => s.name).join(", ") || "none"}.`,
      );
    }

    // --platform only (no specific device named).
    if (/device/.test(plat) && devices[0]) return devices[0];
    const family = /vision/.test(plat) ? "visionOS" : "iOS";
    const byFamily = sims.find((s) => s.os.startsWith(family));
    if (byFamily) return simDestination(byFamily);
    if (devices[0]) return devices[0];
    throw new Error(`No destination available for --platform ${opts.flagPlatform}.`);
  }

  // 2. configured default (used directly when non-interactive)
  const sims = await listSimulators();
  const fromCfg = cfg ? configToDestination(cfg, sims) : null;
  if (!opts.interactive) {
    if (fromCfg) return fromCfg;
    throw new Error(
      "No destination to run on. Set xcode.defaultDestination in premo.json or pass --device.",
    );
  }

  // 3. interactive pick. Float the two most likely choices to the top: the
  // destination last run here (preselected, if still available), then the
  // configured default. The rest keep their natural order below them.
  const devices = await listPhysicalDevices();
  const all = toMenu(sims, devices);
  const last = opts.root ? await readLastXcodeDest(opts.root) : undefined;

  const lastIdx = last ? all.findIndex((d) => d.dest === last.dest) : -1;
  const cfgIdx = fromCfg ? all.findIndex((d) => d.dest === fromCfg.dest) : -1;
  const pinned = [lastIdx, cfgIdx].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
  const order = [...pinned, ...all.map((_, i) => i).filter((i) => !pinned.includes(i))];

  const marker = (i: number) =>
    i === lastIdx ? pc.dim(" — last used") : i === cfgIdx ? pc.dim(" — default") : "";
  const labels = order.map((i) => all[i]!.label + marker(i));
  const defaultIdx =
    pinned.length > 0
      ? 0
      : Math.max(
          0,
          order.findIndex((i) => all[i]!.label.includes("booted")),
        );

  const chosen = await selectFromList(labels, {
    header: `${pc.bold("Select a run destination")} ${pc.dim("(↑/↓ to move, Enter to confirm)")}`,
    defaultIndex: defaultIdx,
  });
  if (chosen === null) throw new Error("destination selection cancelled");
  return all[order[chosen]!]!;
}

// The PREMO_XCODE_* env a verb run needs, or {} when this isn't an xcode
// project. Resolves the destination (flag → default → optional interactive pick)
// and exposes it (plus the bundle id) to the baked commands. PREMO_XCODE_QUIET
// carries `-quiet` by default so `dev` doesn't flood the terminal with build
// output (only warnings/errors show); `verbose` clears it. Returns the empty
// env for every other adapter, so the verb commands stay generic.
export async function xcodeEnvFor(
  manifest: ProjectManifest,
  opts: {
    device?: string;
    platform?: string;
    interactive: boolean;
    verbose?: boolean;
    root?: string;
    // Persist the chosen destination as this project's last-run device (dev).
    remember?: boolean;
  },
): Promise<NodeJS.ProcessEnv> {
  if (manifest.adapter !== "xcode" && !manifest.xcode) return {};
  const dest = await resolveDestination({
    manifest,
    flagDevice: opts.device,
    flagPlatform: opts.platform,
    interactive: opts.interactive && !opts.device && !opts.platform && !!process.stdin.isTTY,
    root: opts.root,
  });
  if (opts.remember && opts.root) {
    await writeLastXcodeDest(opts.root, {
      dest: dest.dest,
      label: dest.label,
      bootUdid: dest.bootUdid,
      deviceUdid: dest.deviceUdid,
    });
  }
  const env: NodeJS.ProcessEnv = {
    PREMO_XCODE_DEST: dest.dest,
    PREMO_XCODE_QUIET: opts.verbose ? "" : "-quiet",
  };
  if (dest.bootUdid) env.PREMO_XCODE_BOOT_UDID = dest.bootUdid;
  if (dest.deviceUdid) env.PREMO_XCODE_DEVICE_UDID = dest.deviceUdid;
  if (manifest.xcode?.bundleId) env.PREMO_XCODE_BUNDLE_ID = manifest.xcode.bundleId;
  return env;
}

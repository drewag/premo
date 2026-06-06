import { execa } from "execa";
import pc from "picocolors";
import type { ProjectManifest, XcodeDestination } from "../../manifest/types.js";
import { selectFromList } from "../select.js";
import { readLastXcodeDest } from "../local.js";

// Discovering simulators / connected devices and resolving which one a verb runs
// on (the one runtime variable for the otherwise-static xcode commands).

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

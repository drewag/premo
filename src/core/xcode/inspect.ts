import { execa } from "execa";
import type { XcodeDestination } from "../../manifest/types.js";
import type { XcodeProject } from "./discovery.js";
import { listSimulators } from "./destinations.js";

// Adopt-time inspection (runs xcodebuild; slow, called once per `premo adopt`).

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

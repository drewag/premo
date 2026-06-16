import { readdir } from "node:fs/promises";
import { shq } from "../shell.js";

// Locating the .xcodeproj / .xcworkspace at a repo root.

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

// The pre-build command for a GENERATED Xcode project, or null if the project
// isn't generated from a spec. xcodegen materializes the .xcodeproj from a
// `project.yml` (commonly gitignored), so it must be (re)generated before any
// xcodebuild — the xcode adapter wires this as the unit's `prebuild` hook.
// Detected by xcodegen's canonical spec filename next to the project. (Tuist's
// Project.swift / a Makefile generate step can extend this list later.)
export const XCODEGEN_PREBUILD = "xcodegen generate";

export async function detectGeneratorPrebuild(root: string): Promise<string | null> {
  try {
    const entries = await readdir(root);
    if (entries.includes("project.yml") || entries.includes("project.yaml"))
      return XCODEGEN_PREBUILD;
  } catch {
    // unreadable dir → no detectable generator
  }
  return null;
}

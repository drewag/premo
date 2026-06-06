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

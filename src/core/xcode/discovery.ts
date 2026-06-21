import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { shq } from "../shell.js";

// Locating the .xcodeproj / .xcworkspace at a repo root.

export interface XcodeProject {
  kind: "workspace" | "project";
  path: string; // basename relative to root, e.g. "Awooga.xcodeproj"
  name: string; // without extension, e.g. "Awooga"
}

// xcodegen's spec filenames. Their presence marks a GENERATED project: the
// .xcodeproj is materialized from the spec (and commonly gitignored), so it may
// be absent on a fresh checkout and must be (re)generated before any xcodebuild.
const XCODEGEN_SPECS = ["project.yml", "project.yaml"];

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

// XcodeGen's top-level `name:` (the generated .xcodeproj's basename). A column-0
// key so a nested `name:` (under targets/schemes) never matches; quotes stripped.
function parseSpecName(text: string): string | null {
  const m = text.match(/^name:[ \t]*(.+?)[ \t]*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() || null : null;
}

export async function findXcodeProject(root: string): Promise<XcodeProject | null> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  const built = pick(entries);
  if (built) return built;
  // No built project — recognize a generator spec so a never-generated checkout
  // is still detected as an Xcode app; the `prebuild` hook regenerates the
  // .xcodeproj before any xcodebuild. The project name comes from the spec.
  const spec = entries.find((e) => XCODEGEN_SPECS.includes(e));
  if (spec) {
    try {
      const name = parseSpecName(await readFile(path.join(root, spec), "utf8"));
      if (name) return { kind: "project", path: `${name}.xcodeproj`, name };
    } catch {
      // unreadable spec → not detectable
    }
  }
  return null;
}

// The `-workspace X` / `-project X` flag for an xcodebuild invocation. The single
// source of truth for the flag's shape, shared by the discovery-time `projectFlag`
// (an `XcodeProject`) and the runner (a resolved `XcodeConfig`) — workspace wins
// when both are set, since it's xcodebuild's entry point.
export function xcodeTargetFlag(opts: { workspace?: string; project?: string }): string {
  return opts.workspace
    ? `-workspace ${shq(opts.workspace)}`
    : `-project ${shq(opts.project ?? "")}`;
}

// The flag for a freshly-discovered project (basename relative to the root).
export function projectFlag(p: XcodeProject): string {
  return p.kind === "workspace"
    ? xcodeTargetFlag({ workspace: p.path })
    : xcodeTargetFlag({ project: p.path });
}

// The pre-build command for a GENERATED Xcode project, or null if the project
// isn't generated from a spec. xcodegen materializes the .xcodeproj from a
// `project.yml`, so it must be (re)generated before any xcodebuild — the xcode
// adapter wires this as the unit's `prebuild` hook. (Tuist's Project.swift / a
// Makefile generate step can extend this list later.)
export const XCODEGEN_PREBUILD = "xcodegen generate";

export async function detectGeneratorPrebuild(root: string): Promise<string | null> {
  try {
    const entries = await readdir(root);
    if (entries.some((e) => XCODEGEN_SPECS.includes(e))) return XCODEGEN_PREBUILD;
  } catch {
    // unreadable dir → no detectable generator
  }
  return null;
}

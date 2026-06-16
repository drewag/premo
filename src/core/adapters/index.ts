import type { ProjectManifestInput, Verb, XcodeConfig } from "../../manifest/types.js";
import { workspacesAdapter } from "./workspaces.js";
import { monorepoAdapter } from "./monorepo.js";
import { nodeScriptsAdapter } from "./node-scripts.js";
import { xcodeAdapter } from "./xcode.js";
import { cliAdapter } from "./cli.js";

// A package as discovered by an adapter, before it's merged with manifest config.
export interface DetectedPackage {
  name: string;
  dirs: string[]; // path prefixes (relative to root) this package owns
  cwd: string; // absolute dir to run this package's commands in
  scripts: Record<string, string>; // package.json scripts, if any
  // "service" (long-running server: piped/prefixed dev, earns a port) vs
  // "command" (run-once/interactive tool: inherited-TTY dev, no port). Default
  // service when omitted.
  kind?: "service" | "command";
  // A best-effort xcode block for a native Apple package, even before `adopt`
  // bakes the richer (bundleId + defaultDestination) one into premo.json. Just
  // the project/workspace path + a guessed scheme — enough for destination
  // resolution to engage so `dev`/`build`/`test` work on a freshly-detected app.
  xcode?: XcodeConfig;
  // A pre-build hook the adapter detected (e.g. `xcodegen generate` when the
  // project is generated from a project.yml). Composed before dev/build/test.
  prebuild?: string;
}

export interface Adapter {
  name: string;
  detect(root: string): Promise<boolean>;
  packages(root: string): Promise<DetectedPackage[]>;
  // The command to run `verb` in `pkg`, or null if the package can't.
  command(verb: Verb, pkg: DetectedPackage, root: string): Promise<string | null>;
  // Optional configure-tier hook: inspect the repo and contribute concrete
  // manifest fields (e.g. baked `commands`, an `xcode` block) for `premo adopt`
  // to write. Adapters that resolve everything live (the node ones) omit this.
  adopt?(root: string): Promise<Partial<ProjectManifestInput>>;
}

// Order matters: more specific adapters first.
//   - workspaces: a declared `workspaces`/pnpm monorepo.
//   - monorepo: a *discovered* manual monorepo (≥2 sub-projects, no declared
//     workspaces). Outranks cli/node-scripts so a root `bin` or aggregator
//     scripts don't hijack a monorepo into looking like a single CLI/package.
//   - cli: a single `bin` package.
//   - node-scripts: any single package.json (the catch-all).
const ADAPTERS: Adapter[] = [
  xcodeAdapter,
  workspacesAdapter,
  monorepoAdapter,
  cliAdapter,
  nodeScriptsAdapter,
];

export async function detectAdapter(root: string): Promise<Adapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(root)) return adapter;
  }
  return null;
}

export function getAdapter(name: string): Adapter | null {
  return ADAPTERS.find((a) => a.name === name) ?? null;
}

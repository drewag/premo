import type { ProjectManifestInput, Verb } from "../../manifest/types.js";
import { yarnWorkspacesAdapter } from "./yarn-workspaces.js";
import { nodeScriptsAdapter } from "./node-scripts.js";
import { xcodeAdapter } from "./xcode.js";
import { cliAdapter } from "./cli.js";

// A target as discovered by an adapter, before it's merged with manifest config.
export interface DetectedTarget {
  name: string;
  dirs: string[]; // path prefixes (relative to root) this target owns
  cwd: string; // absolute dir to run this target's commands in
  scripts: Record<string, string>; // package.json scripts, if any
  // "service" (long-running server: piped/prefixed dev, earns a port) vs
  // "command" (run-once/interactive tool: inherited-TTY dev, no port). Default
  // service when omitted.
  kind?: "service" | "command";
}

export interface Adapter {
  name: string;
  detect(root: string): Promise<boolean>;
  targets(root: string): Promise<DetectedTarget[]>;
  // The command to run `verb` in `target`, or null if the target can't.
  command(verb: Verb, target: DetectedTarget, root: string): string | null;
  // Optional configure-tier hook: inspect the repo and contribute concrete
  // manifest fields (e.g. baked `commands`, an `xcode` block) for `premo adopt`
  // to write. Adapters that resolve everything live (the node ones) omit this.
  adopt?(root: string): Promise<Partial<ProjectManifestInput>>;
}

// Order matters: more specific adapters first. cli (a `bin` package) sits
// between yarn-workspaces (a monorepo with a root bin stays a monorepo) and
// node-scripts (which matches any package.json, so cli must win first).
const ADAPTERS: Adapter[] = [xcodeAdapter, yarnWorkspacesAdapter, cliAdapter, nodeScriptsAdapter];

export async function detectAdapter(root: string): Promise<Adapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(root)) return adapter;
  }
  return null;
}

export function getAdapter(name: string): Adapter | null {
  return ADAPTERS.find((a) => a.name === name) ?? null;
}

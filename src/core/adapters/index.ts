import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifestInput, Verb } from "../../manifest/types.js";
import { yarnWorkspacesAdapter } from "./yarn-workspaces.js";
import { nodeScriptsAdapter } from "./node-scripts.js";
import { xcodeAdapter } from "./xcode.js";

// A target as discovered by an adapter, before it's merged with manifest config.
export interface DetectedTarget {
  name: string;
  dirs: string[]; // path prefixes (relative to root) this target owns
  cwd: string; // absolute dir to run this target's commands in
  scripts: Record<string, string>; // package.json scripts, if any
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

// Order matters: more specific adapters first.
const ADAPTERS: Adapter[] = [xcodeAdapter, yarnWorkspacesAdapter, nodeScriptsAdapter];

export async function detectAdapter(root: string): Promise<Adapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(root)) return adapter;
  }
  return null;
}

export function getAdapter(name: string): Adapter | null {
  return ADAPTERS.find((a) => a.name === name) ?? null;
}

// --- shared node helpers (used by both node adapters) ---

export type PackageManager = "yarn" | "npm" | "pnpm";

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(root, "package-lock.json"))) return "npm";
  return "yarn"; // yarn.lock, or default per project convention
}

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export async function readPackageJson(dir: string): Promise<PackageJson | null> {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

// First matching script for a verb, trying common aliases.
const SCRIPT_ALIASES: Record<Verb, string[]> = {
  dev: ["dev", "start", "serve"],
  build: ["build"],
  test: ["test"],
  lint: ["lint"],
  deploy: ["deploy"],
};

export function scriptCommandForVerb(
  verb: Verb,
  scripts: Record<string, string>,
  pm: PackageManager,
): string | null {
  const script = SCRIPT_ALIASES[verb].find((s) => scripts[s] !== undefined);
  if (!script) return null;
  const base = pm === "npm" ? `npm run ${script}` : `${pm} ${script}`; // yarn/pnpm <script>

  // Vite ignores premo's $PORT env (unlike Next/CRA), so a `dev` that runs Vite
  // would bind 5173 and collide across projects. Forward the allocated port as
  // `--port` when set; `${PORT:+…}` keeps it absent when no port was allocated.
  if (verb === "dev" && /(^|\s|\/)vite(\s|$)/.test(scripts[script]!)) {
    const port = "${PORT:+--port $PORT}"; // npm needs `--` before script args
    return pm === "npm" ? `${base} -- ${port}` : `${base} ${port}`;
  }
  return base;
}

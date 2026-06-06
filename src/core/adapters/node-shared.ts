import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Verb } from "../../manifest/types.js";

// Shared helpers for the Node-based adapters (node-scripts, workspaces, cli).

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
  bin?: string | Record<string, string>;
  private?: boolean;
  devDependencies?: Record<string, string>;
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

// The single executable a CLI package exposes. `bin` is either a bare path or a
// name→path map; for a map prefer the entry matching the package name, else the
// first. Returns null when there's no bin.
export function binEntry(pkg: PackageJson): string | null {
  const bin = pkg.bin;
  if (!bin) return null;
  if (typeof bin === "string") return bin;
  const keys = Object.keys(bin);
  if (keys.length === 0) return null;
  const preferred = pkg.name && bin[pkg.name] ? pkg.name : keys[0]!;
  return bin[preferred]!;
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

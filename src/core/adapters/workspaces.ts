import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedPackage } from "./index.js";
import {
  detectPackageManager,
  type PackageJson,
  readPackageJson,
  scriptCommandForVerb,
} from "./node-shared.js";

// Workspace globs from a package.json `workspaces` field (yarn + npm).
function packageJsonPatterns(ws: PackageJson["workspaces"]): string[] {
  if (!ws) return [];
  return Array.isArray(ws) ? ws : (ws.packages ?? []);
}

// Workspace globs from pnpm-workspace.yaml (`packages:`).
async function pnpmPatterns(root: string): Promise<string[]> {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return [];
  try {
    const doc = parseYaml(await readFile(file, "utf8")) as { packages?: string[] };
    return Array.isArray(doc?.packages) ? doc.packages : [];
  } catch {
    return [];
  }
}

// The repo's workspace globs, however the package manager declares them.
async function workspaceGlobs(root: string): Promise<string[]> {
  const pkg = await readPackageJson(root);
  const fromPkg = packageJsonPatterns(pkg?.workspaces);
  return fromPkg.length ? fromPkg : pnpmPatterns(root);
}

// Expand a workspace pattern (`packages/*`, `apps/*`, or a literal `frontend`)
// into the directories that actually contain a package.json.
async function expandPattern(root: string, pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) {
    return [path.join(root, pattern)];
  }
  const star = pattern.indexOf("*");
  const parent = path.join(root, pattern.slice(0, star));
  const dirs: string[] = [];
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(path.join(parent, e.name));
    }
  } catch {
    /* parent doesn't exist — no matches */
  }
  return dirs;
}

// Workspaces monorepo (yarn / npm `workspaces`, or pnpm-workspace.yaml): one
// package per workspace. The detected package manager drives the per-package
// commands (`yarn`/`npm run`/`pnpm <script>`).
export const workspacesAdapter: Adapter = {
  name: "workspaces",

  async detect(root: string): Promise<boolean> {
    return (await workspaceGlobs(root)).length > 0;
  },

  async packages(root: string): Promise<DetectedPackage[]> {
    const patterns = await workspaceGlobs(root);
    const seen = new Set<string>();
    const packages: DetectedPackage[] = [];

    for (const pattern of patterns) {
      for (const dir of await expandPattern(root, pattern)) {
        if (seen.has(dir)) continue;
        const wsPkg = await readPackageJson(dir);
        if (!wsPkg) continue;
        seen.add(dir);
        const rel = path.relative(root, dir);
        const name = sanitizeProjectName(wsPkg.name ?? path.basename(dir));
        packages.push({
          name,
          dirs: [rel ? `${rel}/` : "./"],
          cwd: dir,
          scripts: wsPkg.scripts ?? {},
        });
      }
    }
    return packages;
  },

  async command(verb: Verb, pkg: DetectedPackage, root: string): Promise<string | null> {
    // Run from the workspace dir itself, so `<pm> <script>` resolves to it.
    return scriptCommandForVerb(verb, pkg.scripts, detectPackageManager(root));
  },
};

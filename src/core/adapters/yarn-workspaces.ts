import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedTarget } from "./index.js";
import { detectPackageManager, readPackageJson, scriptCommandForVerb } from "./node-shared.js";

function workspacePatterns(
  ws: NonNullable<Awaited<ReturnType<typeof readPackageJson>>>["workspaces"],
): string[] {
  if (!ws) return [];
  return Array.isArray(ws) ? ws : (ws.packages ?? []);
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

// Yarn/npm workspaces monorepo: one target per workspace package.
export const yarnWorkspacesAdapter: Adapter = {
  name: "yarn-workspaces",

  async detect(root: string): Promise<boolean> {
    const pkg = await readPackageJson(root);
    return workspacePatterns(pkg?.workspaces).length > 0;
  },

  async targets(root: string): Promise<DetectedTarget[]> {
    const pkg = await readPackageJson(root);
    const patterns = workspacePatterns(pkg?.workspaces);
    const seen = new Set<string>();
    const targets: DetectedTarget[] = [];

    for (const pattern of patterns) {
      for (const dir of await expandPattern(root, pattern)) {
        if (seen.has(dir)) continue;
        const wsPkg = await readPackageJson(dir);
        if (!wsPkg) continue;
        seen.add(dir);
        const rel = path.relative(root, dir);
        const name = sanitizeProjectName(wsPkg.name ?? path.basename(dir));
        targets.push({
          name,
          dirs: [rel ? `${rel}/` : "./"],
          cwd: dir,
          scripts: wsPkg.scripts ?? {},
        });
      }
    }
    return targets;
  },

  async command(verb: Verb, target: DetectedTarget, root: string): Promise<string | null> {
    // Run from the workspace dir itself, so `yarn <script>` resolves to it.
    return scriptCommandForVerb(verb, target.scripts, detectPackageManager(root));
  },
};

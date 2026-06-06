import path from "node:path";
import type { Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedTarget } from "./index.js";
import { detectPackageManager, readPackageJson, scriptCommandForVerb } from "./node-shared.js";

// Single-package Node project: one target rooted at the repo, commands map to
// the root package.json scripts via the detected package manager.
export const nodeScriptsAdapter: Adapter = {
  name: "node-scripts",

  async detect(root: string): Promise<boolean> {
    return (await readPackageJson(root)) !== null;
  },

  async targets(root: string): Promise<DetectedTarget[]> {
    const pkg = await readPackageJson(root);
    if (!pkg) return [];
    const name = sanitizeProjectName(pkg.name ?? path.basename(root));
    return [{ name, dirs: ["."], cwd: root, scripts: pkg.scripts ?? {} }];
  },

  async command(verb: Verb, target: DetectedTarget, root: string): Promise<string | null> {
    return scriptCommandForVerb(verb, target.scripts, detectPackageManager(root));
  },
};

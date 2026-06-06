import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProjectManifestInput, Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedTarget } from "./index.js";
import {
  type PackageJson,
  binEntry,
  detectPackageManager,
  readPackageJson,
  scriptCommandForVerb,
} from "./node-shared.js";

// CLI-style Node project: a package with a `bin`, run as a command rather than a
// dev server. One target at the repo root, kind "command" (inherited-TTY dev, no
// port). build/test/lint defer to package.json scripts; `dev` runs the tool from
// source so `premo dev -- <args>` invokes it with passthrough.

function readPackageJsonSync(root: string): PackageJson | null {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

// Resolve the command that runs the CLI in dev. Best-effort, shared by the live
// `command()` preview and the `adopt()` bake:
//   1. tsx <src> — map the bin's compiled path back to TS source (strip a leading
//      `dist/`, swap `.js`→`.ts`) when that source exists and tsx is a devDep.
//   2. a `dev`/`start` script, if the package defines one.
//   3. node <binEntry> — the built output, as a last resort.
export function resolveCliDev(root: string, pkg: PackageJson): string | null {
  const pm = detectPackageManager(root);
  const bin = binEntry(pkg);
  if (bin) {
    const rel = bin.replace(/^\.?\//, "").replace(/^dist\//, "");
    const src = rel.replace(/\.js$/, ".ts");
    const hasTsx = !!pkg.devDependencies?.tsx;
    if (hasTsx && src.endsWith(".ts") && existsSync(path.join(root, src))) {
      // Resolve tsx through the package manager — when premo shells this out,
      // node_modules/.bin isn't on PATH, so a bare `tsx` would not be found. Use
      // the quiet form so the tool's own stdout stays clean (pipeable as JSON).
      const exec = pm === "npm" ? "npx" : pm === "pnpm" ? "pnpm exec" : "yarn --silent";
      return `${exec} tsx ${src}`;
    }
  }

  const scripts = pkg.scripts ?? {};
  const script = ["dev", "start"].find((s) => scripts[s] !== undefined);
  if (script) {
    return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
  }

  if (bin) return `node ${bin.replace(/^\.?\//, "")}`;
  return null;
}

export const cliAdapter: Adapter = {
  name: "cli",

  async detect(root: string): Promise<boolean> {
    const pkg = await readPackageJson(root);
    return !!pkg && binEntry(pkg) !== null;
  },

  async targets(root: string): Promise<DetectedTarget[]> {
    const pkg = await readPackageJson(root);
    if (!pkg) return [];
    const name = sanitizeProjectName(pkg.name ?? path.basename(root));
    return [{ name, dirs: ["."], cwd: root, scripts: pkg.scripts ?? {}, kind: "command" }];
  },

  command(verb: Verb, target: DetectedTarget, root: string): string | null {
    switch (verb) {
      case "dev": {
        const pkg = readPackageJsonSync(root);
        return pkg ? resolveCliDev(root, pkg) : null;
      }
      case "deploy":
        return null; // baked in adopt() when the package is publishable
      default:
        return scriptCommandForVerb(verb, target.scripts, detectPackageManager(root));
    }
  },

  // Configure tier (DESIGN §3): bake the concrete dev command (source resolution
  // is involved) and, for a publishable package, a deploy command.
  async adopt(root: string): Promise<Partial<ProjectManifestInput>> {
    const pkg = await readPackageJson(root);
    if (!pkg) return {};

    const commands: Record<string, string> = {};
    const dev = resolveCliDev(root, pkg);
    if (dev) commands.dev = dev;
    // Only presume `npm publish` for a public package; private/other CLIs wire
    // their own deploy by hand.
    if (pkg.private !== true) commands.deploy = "npm publish";

    return Object.keys(commands).length > 0 ? { commands } : {};
  },
};

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ProjectManifestInput, Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedPackage } from "./index.js";
import { xcodeAdapter } from "./xcode.js";
import { cliAdapter } from "./cli.js";
import { nodeScriptsAdapter } from "./node-scripts.js";

// Manual monorepo: a repo whose sub-projects live in immediate child directories
// without a declared `workspaces` field (the common product-monorepo shape —
// e.g. odo/email). We discover members one level deep, resolve each with its own
// leaf adapter (so the monorepo is polyglot — node packages + an Xcode app +
// a CLI), and key packages by DIRECTORY name. See DESIGN.md §13.2.
//
// The root's own scripts/bin are intentionally ignored: a dev-tool `bin` at the
// root (odo's `bin/odo.ts`) must not turn the whole monorepo into a `cli`.

// Leaf adapters a member can resolve to. Excludes `monorepo` itself — that
// enforces the one-level-deep limit (a member that is itself a manual monorepo
// resolves as a single node package, not a nested rollup) and avoids recursion.
const CHILD_ADAPTERS: Adapter[] = [xcodeAdapter, cliAdapter, nodeScriptsAdapter];

// Directories that never hold a member project; skipped for speed and safety.
const SKIP = new Set(["node_modules", ".git", ".runtime", "dist", "build", "coverage", ".premo"]);

async function memberDirs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .map((e) => path.join(root, e.name))
    .sort();
}

async function childAdapterFor(dir: string): Promise<Adapter | null> {
  for (const adapter of CHILD_ADAPTERS) {
    if (await adapter.detect(dir)) return adapter;
  }
  return null;
}

// A member's resolved leaf adapter + its detected package, stashed on the
// DetectedPackage so `command()` can delegate verb resolution to the leaf.
const delegates = new WeakMap<DetectedPackage, { adapter: Adapter; pkg: DetectedPackage }>();

export const monorepoAdapter: Adapter = {
  name: "monorepo",

  async detect(root: string): Promise<boolean> {
    let count = 0;
    for (const dir of await memberDirs(root)) {
      if (await childAdapterFor(dir)) count++;
      if (count >= 2) return true;
    }
    return false;
  },

  async packages(root: string): Promise<DetectedPackage[]> {
    const result: DetectedPackage[] = [];
    for (const dir of await memberDirs(root)) {
      const adapter = await childAdapterFor(dir);
      if (!adapter) continue;
      // Leaf adapters return a single package rooted at the member dir; re-root
      // it under the monorepo, keyed by directory name (not package name).
      const childPkg = (await adapter.packages(dir))[0];
      if (!childPkg) continue;
      const rel = path.relative(root, dir);
      const pkg: DetectedPackage = {
        name: sanitizeProjectName(path.basename(dir)),
        dirs: [`${rel}/`],
        cwd: dir,
        scripts: childPkg.scripts,
        kind: childPkg.kind,
        // Carry up a native member's best-effort xcode block. Its project path
        // stays relative to the member dir (= this package's cwd), so the xcode
        // runner's `-project`/`-workspace` resolves from the dir the verb runs in.
        ...(childPkg.xcode ? { xcode: childPkg.xcode } : {}),
      };
      delegates.set(pkg, { adapter, pkg: childPkg });
      result.push(pkg);
    }
    return result;
  },

  async command(verb: Verb, pkg: DetectedPackage, _root: string): Promise<string | null> {
    const d = delegates.get(pkg);
    if (!d) return null;
    // Resolve from the member's own root so the leaf adapter sees its scripts,
    // package manager, and (for xcode) its project.
    return d.adapter.command(verb, d.pkg, d.pkg.cwd);
  },

  // Configure tier: bake each native-app member's xcode block (scheme, bundle id,
  // default destination — paths relative to the member dir) onto that package, so
  // dev/build/test on it are reproducible (DESIGN §13.2). Other members need no
  // baked config (their commands resolve live from package.json scripts).
  async adopt(root: string): Promise<Partial<ProjectManifestInput>> {
    const packages: NonNullable<ProjectManifestInput["packages"]> = [];
    for (const dir of await memberDirs(root)) {
      const adapter = await childAdapterFor(dir);
      if (adapter?.name !== "xcode" || !adapter.adopt) continue;
      const baked = await adapter.adopt(dir);
      if (baked.xcode) {
        packages.push({ name: sanitizeProjectName(path.basename(dir)), xcode: baked.xcode });
      }
    }
    return packages.length > 0 ? { packages } : {};
  },
};

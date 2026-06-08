import path from "node:path";
import { ProjectManifest, type ProjectManifestInput } from "../manifest/types.js";
import {
  PROJECT_FILE,
  findProjectRoot,
  loadProject,
  saveProject,
  sanitizeProjectName,
} from "./project.js";
import { detectAdapter } from "./adapters/index.js";
import { readPackageJson } from "./adapters/node-shared.js";
import { resolveTargets, toTargetConfig, assignTargetPorts, portsNeeded } from "./targets.js";
import { ensurePremoGitignore } from "./local.js";
import { gitRoot } from "./git.js";
import { allocatePortBlock } from "./port-registry.js";
import { DEFAULT_BLOCK } from "./ports.js";
import { log } from "./logger.js";

export interface Context {
  root: string;
  manifest: ProjectManifest;
}

export interface Inspection {
  root: string;
  manifest: ProjectManifest;
  adopted: boolean; // a premo.json already exists on disk
  adapterName: string | null;
}

// Like ensureContext, but READ-ONLY: never writes a premo.json and never
// allocates ports. For an un-adopted repo it returns the manifest that *would*
// be written. Used by `premo doctor` to diagnose without side effects.
export async function inspectContext(cwd: string): Promise<Inspection> {
  const existing = findProjectRoot(cwd);
  if (existing) {
    const manifest = await loadProject(existing);
    const adapterName = manifest.adapter ?? (await detectAdapter(existing))?.name ?? null;
    return { root: existing, manifest, adopted: true, adapterName };
  }

  const root = (await gitRoot(cwd)) ?? cwd;
  const adapter = await detectAdapter(root);
  const rootPkg = await readPackageJson(root);
  const name = sanitizeProjectName(rootPkg?.name ?? path.basename(root));
  const detected = adapter ? await adapter.packages(root) : [];
  const packages = detected.map((d) => ({ name: d.name, dirs: d.dirs }));
  const manifest = ProjectManifest.parse({
    name,
    ...(adapter ? { adapter: adapter.name } : {}),
    packages,
  });
  return { root, manifest, adopted: false, adapterName: adapter?.name ?? null };
}

// Load the project context, auto-adopting (writing a premo.json) on first
// touch of an un-adopted repo. See DESIGN.md §3 — there is no permanent
// zero-config mode; every touched project ends up with the lingua-franca config.
export async function ensureContext(cwd: string): Promise<Context> {
  const existingRoot = findProjectRoot(cwd);
  if (existingRoot) {
    return { root: existingRoot, manifest: await loadProject(existingRoot) };
  }
  const root = (await gitRoot(cwd)) ?? cwd;
  const manifest = await adoptProject(root);
  return { root, manifest };
}

// Detect the stack, allocate a conflict-free port block if anything serves,
// and write premo.json. Idempotent enough to re-run via `premo adopt`.
export async function adoptProject(
  root: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<ProjectManifest> {
  const adapter = await detectAdapter(root);
  const rootPkg = await readPackageJson(root);
  const name = sanitizeProjectName(rootPkg?.name ?? path.basename(root));
  const detected = adapter ? await adapter.packages(root) : [];

  let packages: ProjectManifestInput["packages"] = detected.map((d) => ({
    name: d.name,
    dirs: d.dirs,
  }));

  // Configure-tier adapters (e.g. xcode) bake concrete commands + extra config.
  const baked = adapter?.adopt ? await adapter.adopt(root) : {};

  // An adapter may also contribute per-package config (e.g. the monorepo adapter
  // bakes an `xcode` block onto a native-app member). Merge it by name rather
  // than letting the spread clobber the detected `packages`.
  if (baked.packages) {
    const extra = new Map(baked.packages.map((p) => [p.name, p]));
    packages = packages?.map((p) => ({ ...p, ...(extra.get(p.name!) ?? {}) }));
    delete baked.packages;
  }

  const draft: ProjectManifestInput = {
    name,
    version: "0",
    ...(adapter ? { adapter: adapter.name } : {}),
    packages,
    ...baked,
  };

  // Seed run/deploy targets 1:1 from the resolved packages (DESIGN §13.3) and
  // materialize them; composite targets (e.g. a compose stack) are added by hand.
  const seeded = await resolveTargets(root, ProjectManifest.parse(draft));

  // Each serving target earns its own base port within the project block, so
  // concurrent `premo dev` servers don't collide. Native apps (xcode) and
  // compose/CLI targets don't serve, so they skip allocation. (DESIGN §13.4.)
  let portInfo = "";
  const xcodeNames = new Set((draft.packages ?? []).filter((p) => p.xcode).map((p) => p.name!));
  const need = portsNeeded(seeded, xcodeNames);
  if (need > 0) {
    const blockSize = Math.max(DEFAULT_BLOCK, Math.ceil(need / DEFAULT_BLOCK) * DEFAULT_BLOCK);
    const alloc = await allocatePortBlock(root, name, blockSize);
    draft.ports = { base: alloc.base, block: alloc.block };
    assignTargetPorts(seeded, alloc.base, xcodeNames);
    portInfo = `, ports ${alloc.base}–${alloc.base + alloc.block - 1}`;
  }

  if (seeded.length > 0) draft.targets = seeded.map(toTargetConfig);

  const manifest = ProjectManifest.parse(draft); // validate
  await saveProject(root, draft); // write the clean, un-defaulted version
  await ensurePremoGitignore(root); // keep premo-local state out of git

  const detail = adapter
    ? `detected ${adapter.name}, ${detected.length} target(s)`
    : "no adapter matched";
  if (!quiet) {
    log.ok(`wrote ${PROJECT_FILE} — ${detail}${portInfo}`);
    if (!adapter) {
      log.dim('  no commands resolved yet; add them under "commands" in premo.json,');
      log.dim("  or run `premo skill` to generate a task file for a coding agent.");
    }
  }
  return manifest;
}

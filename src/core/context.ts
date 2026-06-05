import path from "node:path";
import { ProjectManifest, type ProjectManifestInput } from "../strand-api/types.js";
import {
  PROJECT_FILE,
  findProjectRoot,
  loadProject,
  saveProject,
  sanitizeProjectName,
} from "./project.js";
import { detectAdapter, readPackageJson } from "./adapters/index.js";
import { gitRoot } from "./git.js";
import { allocatePortBlock } from "./registry.js";
import { log } from "./logger.js";

export interface Context {
  root: string;
  manifest: ProjectManifest;
}

export interface Inspection {
  root: string;
  manifest: ProjectManifest;
  adopted: boolean; // a strand.json already exists on disk
  adapterName: string | null;
}

// Like ensureContext, but READ-ONLY: never writes a strand.json and never
// allocates ports. For an un-adopted repo it returns the manifest that *would*
// be written. Used by `strand doctor` to diagnose without side effects.
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
  const detected = adapter ? await adapter.targets(root) : [];
  const targets: Record<string, { dirs: string[] }> = {};
  for (const t of detected) targets[t.name] = { dirs: t.dirs };
  const manifest = ProjectManifest.parse({
    name,
    ...(adapter ? { adapter: adapter.name } : {}),
    targets,
  });
  return { root, manifest, adopted: false, adapterName: adapter?.name ?? null };
}

// Load the project context, auto-adopting (writing a strand.json) on first
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
// and write strand.json. Idempotent enough to re-run via `strand adopt`.
export async function adoptProject(root: string): Promise<ProjectManifest> {
  const adapter = await detectAdapter(root);
  const rootPkg = await readPackageJson(root);
  const name = sanitizeProjectName(rootPkg?.name ?? path.basename(root));
  const detected = adapter ? await adapter.targets(root) : [];

  const targets: Record<string, { dirs: string[] }> = {};
  for (const t of detected) targets[t.name] = { dirs: t.dirs };

  // Configure-tier adapters (e.g. xcode) bake concrete commands + extra config.
  const baked = adapter?.adopt ? await adapter.adopt(root) : {};

  const draft: ProjectManifestInput = {
    name,
    version: "0",
    ...(adapter ? { adapter: adapter.name } : {}),
    targets,
    ...baked,
  };

  let portInfo = "";
  // A dev command that binds an HTTP port earns a port block. Native apps (xcode)
  // run a process but don't serve, so they skip allocation.
  const serves =
    adapter?.name !== "xcode" &&
    !!adapter &&
    detected.some((t) => adapter.command("dev", t, root) !== null);
  if (serves) {
    const alloc = await allocatePortBlock(root, name);
    draft.ports = { base: alloc.base, block: alloc.block };
    portInfo = `, ports ${alloc.base}–${alloc.base + alloc.block - 1}`;
  }

  const manifest = ProjectManifest.parse(draft); // validate
  await saveProject(root, draft); // write the clean, un-defaulted version

  const detail = adapter
    ? `detected ${adapter.name}, ${detected.length} target(s)`
    : "no adapter matched";
  log.ok(`wrote ${PROJECT_FILE} — ${detail}${portInfo}`);
  if (!adapter) {
    log.dim('  no commands resolved yet; add them under "commands" in strand.json.');
  }
  return manifest;
}

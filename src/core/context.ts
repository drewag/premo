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
import { resolveTargets, toTargetConfig } from "./targets.js";
import { ensurePremoGitignore } from "./local.js";
import { gitRoot } from "./git.js";
import { allocatePortBlock } from "./port-registry.js";
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

  const packages = detected.map((d) => ({ name: d.name, dirs: d.dirs }));

  // Configure-tier adapters (e.g. xcode) bake concrete commands + extra config.
  const baked = adapter?.adopt ? await adapter.adopt(root) : {};

  const draft: ProjectManifestInput = {
    name,
    version: "0",
    ...(adapter ? { adapter: adapter.name } : {}),
    packages,
    ...baked,
  };

  let portInfo = "";
  // A dev command that binds an HTTP port earns a port block. Native apps (xcode)
  // and command-style CLIs run a process but don't serve, so they skip allocation.
  let serves = false;
  if (adapter && adapter.name !== "xcode") {
    for (const p of detected) {
      if ((p.kind ?? "service") === "service" && (await adapter.command("dev", p, root)) !== null) {
        serves = true;
        break;
      }
    }
  }
  if (serves) {
    const alloc = await allocatePortBlock(root, name);
    draft.ports = { base: alloc.base, block: alloc.block };
    portInfo = `, ports ${alloc.base}–${alloc.base + alloc.block - 1}`;
  }

  // Seed run/deploy targets 1:1 from the resolved packages (DESIGN §13.3) and
  // materialize them; composite targets (e.g. a compose stack) are added by hand.
  const seeded = await resolveTargets(root, ProjectManifest.parse(draft));
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

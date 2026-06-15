import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { ProjectManifest, type ProjectManifestInput } from "../manifest/types.js";
import {
  PROJECT_FILE,
  findProjectRoot,
  loadProject,
  readRawProject,
  saveProject,
  sanitizeProjectName,
} from "./project.js";
import { detectAdapter } from "./adapters/index.js";
import { readPackageJson } from "./adapters/node-shared.js";
import { resolveTargets, toTargetConfig, servesHttp, PORT_STEP } from "./targets.js";
import { ensurePremoGitignore } from "./local.js";
import { gitRoot } from "./git.js";
import { allocatePortBlock } from "./port-registry.js";
import { DEFAULT_BLOCK } from "./ports.js";
import { mergeAdopt, changesEmpty, type AdoptChanges, type AdoptStale } from "./adopt-merge.js";
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

// Per-environment dotenv overlays (`.env.<env>` next to the base `envFile`) seed
// the environments axis for non-xcode repos (DESIGN §15) — the way several xcode
// schemes do for native apps. Conventional non-overlay siblings are ignored.
const ENV_FILE_IGNORE = new Set([
  "example",
  "sample",
  "local",
  "template",
  "templates",
  "defaults",
  "dist",
  "test",
]);
const ENV_DEFAULTISH = ["development", "dev", "local", "sandbox", "debug"];
const ENV_DEPLOYISH = ["production", "prod", "staging", "release", "live"];

function detectEnvironments(
  root: string,
  envFile: string | undefined,
): NonNullable<ProjectManifestInput["environments"]> | undefined {
  if (!envFile) return undefined;
  const baseName = path.basename(envFile);
  const dir = path.dirname(path.join(root, envFile));
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.startsWith(baseName + "."))
      .map((f) => f.slice(baseName.length + 1))
      // skip `.env.<x>.local` (a dotted remainder) and conventional non-overlays
      .filter((s) => s.length > 0 && !s.includes(".") && !ENV_FILE_IGNORE.has(s));
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;
  const def = names.find((n) => ENV_DEFAULTISH.includes(n)) ?? names[0];
  return names.map((n) => ({
    name: n,
    ...(n === def ? { default: true } : {}),
    ...(ENV_DEPLOYISH.includes(n) ? { deploy: true } : {}),
  }));
}

// The clean, un-defaulted draft a fresh adopt would write, plus the facts the
// caller needs for messaging. Targets are seeded and materialized but carry no
// ports yet — port reconciliation is a separate, mergeable pass (see below).
interface DetectResult {
  draft: ProjectManifestInput;
  adapterName: string | null;
  packageCount: number;
}

// Detect the stack and build the draft manifest, stopping short of port
// allocation and disk I/O. Shared by fresh adopt and additive sync.
async function detectDraft(root: string): Promise<DetectResult> {
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
    // A repo `.env` is loaded into verb-run env so host processes see the same
    // config docker compose already auto-loads. Detected here; editable/disable-able.
    ...(existsSync(path.join(root, ".env")) ? { envFile: ".env" } : {}),
    packages,
    ...baked,
  };

  // Seed the environments axis from `.env.<env>` overlays, unioned with any envs
  // an adapter already baked (e.g. xcode dev/prod schemes). A baked default wins;
  // otherwise the env-file detection's own default stands.
  const envFileEnvs = detectEnvironments(
    root,
    typeof draft.envFile === "string" ? draft.envFile : undefined,
  );
  if (envFileEnvs) {
    const existing = draft.environments ?? [];
    const have = new Set(existing.map((e) => e.name));
    const hasDefault = existing.some((e) => e.default);
    const additions = envFileEnvs
      .filter((e) => !have.has(e.name))
      .map((e) =>
        hasDefault && e.default ? { name: e.name, ...(e.deploy ? { deploy: true } : {}) } : e,
      );
    if (additions.length > 0) draft.environments = [...existing, ...additions];
  }

  // Seed run/deploy targets 1:1 from the resolved packages (DESIGN §13.3) and
  // materialize them (without ports); composite targets are added by hand.
  const seeded = await resolveTargets(root, ProjectManifest.parse(draft));
  if (seeded.length > 0) draft.targets = seeded.map(toTargetConfig);

  return { draft, adapterName: adapter?.name ?? null, packageCount: detected.length };
}

// Each serving target earns its own base port within the project block, so
// concurrent `premo dev` servers don't collide. Native apps (xcode) and
// compose/CLI targets don't serve, so they skip allocation (DESIGN §13.4).
// Mutates `draft` in place: ensures `draft.ports` and assigns a free offset to
// every serving target that lacks one — existing assignments are left untouched,
// which is what makes a re-adopt additive rather than a reshuffle. Returns the
// project block (for messaging) and the names of targets newly given a port.
async function reconcilePorts(
  root: string,
  draft: ProjectManifestInput,
): Promise<{ block: { base: number; block: number } | null; assigned: string[] }> {
  // A package is native (xcode) — and so non-serving — either via its own `xcode`
  // block (monorepo member) or via a top-level `xcode` block (single-app repo,
  // where the lone package carries no per-package block). Both must skip ports.
  const topXcode = !!draft.xcode;
  const xcodeNames = new Set(
    (draft.packages ?? []).filter((p) => p.xcode || topXcode).map((p) => p.name!),
  );
  const targets = await resolveTargets(root, ProjectManifest.parse(draft));
  const serving = targets.filter((t) => servesHttp(t, xcodeNames));
  if (serving.length === 0) return { block: null, assigned: [] };

  // Reuse the existing block when there is one (the registry is idempotent and
  // keyed by path); otherwise allocate one sized to fit every serving target.
  const need = serving.length * PORT_STEP;
  const blockSize = Math.max(DEFAULT_BLOCK, Math.ceil(need / DEFAULT_BLOCK) * DEFAULT_BLOCK);
  const alloc = await allocatePortBlock(root, String(draft.name), blockSize);
  draft.ports = { base: alloc.base, block: alloc.block };

  const cfgByName = new Map((draft.targets ?? []).map((t) => [t.name, t]));
  const used = new Set<number>();
  for (const t of serving) {
    const cfg = cfgByName.get(t.name);
    if (cfg?.ports) used.add(cfg.ports.base);
  }
  const assigned: string[] = [];
  let offset = 0;
  for (const t of serving) {
    const cfg = cfgByName.get(t.name);
    if (!cfg || cfg.ports) continue; // keep an existing assignment
    while (used.has(alloc.base + offset)) offset += PORT_STEP;
    cfg.ports = { base: alloc.base + offset };
    used.add(alloc.base + offset);
    offset += PORT_STEP;
    assigned.push(t.name);
  }
  return { block: { base: alloc.base, block: alloc.block }, assigned };
}

// Detect the stack, allocate a conflict-free port block if anything serves, and
// write a fresh premo.json — discarding any existing one. This is the first-adopt
// path and the `--force` re-adopt; for a non-destructive re-adopt, see syncProject.
export async function adoptProject(
  root: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<ProjectManifest> {
  const { draft, adapterName, packageCount } = await detectDraft(root);
  const { block } = await reconcilePorts(root, draft);
  const portInfo = block ? `, ports ${block.base}–${block.base + block.block - 1}` : "";

  const manifest = ProjectManifest.parse(draft); // validate
  await saveProject(root, draft); // write the clean, un-defaulted version
  await ensurePremoGitignore(root); // keep premo-local state out of git

  const detail = adapterName
    ? `detected ${adapterName}, ${packageCount} target(s)`
    : "no adapter matched";
  if (!quiet) {
    log.ok(`wrote ${PROJECT_FILE} — ${detail}${portInfo}`);
    if (!adapterName) {
      log.dim('  no commands resolved yet; add them under "commands" in premo.json,');
      log.dim("  or run `premo skill` to generate a task file for a coding agent.");
    }
  }
  return manifest;
}

export interface SyncResult {
  manifest: ProjectManifest;
  changes: AdoptChanges;
  stale: AdoptStale;
  changed: boolean;
}

// Non-destructive re-adopt: fold newly-detected features into the existing
// premo.json without overriding anything the user configured (see adopt-merge).
// Allocates ports only for newly-added serving targets, and writes only when the
// merge actually changed something — so it's safe and idempotent to re-run.
export async function syncProject(root: string): Promise<SyncResult> {
  const existing = await readRawProject(root);
  const { draft: detected } = await detectDraft(root);
  const { merged, changes, stale } = mergeAdopt(existing, detected);

  // Ports are reconciled against the merged manifest so that only targets without
  // an existing assignment (e.g. ones we just appended) draw from the block.
  const { assigned } = await reconcilePorts(root, merged);

  const manifest = ProjectManifest.parse(merged); // validate before write
  const changed = !changesEmpty(changes) || assigned.length > 0;
  if (changed) {
    await saveProject(root, merged);
    await ensurePremoGitignore(root);
  }
  return { manifest, changes, stale, changed };
}

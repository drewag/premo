import type { ProjectManifest, Verb } from "../premo-api/types.js";
import { VERBS } from "../premo-api/types.js";
import { type Adapter, detectAdapter, getAdapter } from "./adapters/index.js";

// A fully-resolved unit of work: where to run, what it owns (for affected
// detection), and the concrete command for each verb (config > adapter).
export interface Target {
  name: string;
  dirs: string[];
  affects: string[];
  affectsExcept: string[];
  cwd: string;
  commands: Partial<Record<Verb, string>>;
}

async function adapterFor(root: string, manifest: ProjectManifest): Promise<Adapter | null> {
  if (manifest.adapter) {
    const named = getAdapter(manifest.adapter);
    if (named) return named;
  }
  return detectAdapter(root);
}

// Resolution order per DESIGN.md §3: per-target config > project config > adapter.
export async function resolveTargets(root: string, manifest: ProjectManifest): Promise<Target[]> {
  const adapter = await adapterFor(root, manifest);
  const detected = adapter ? await adapter.targets(root) : [];
  const detectedByName = new Map(detected.map((d) => [d.name, d]));

  const names = new Set<string>([...detectedByName.keys(), ...Object.keys(manifest.targets)]);
  const targets: Target[] = [];

  for (const name of names) {
    const det = detectedByName.get(name);
    const cfg = manifest.targets[name];
    const dirs = cfg?.dirs.length ? cfg.dirs : (det?.dirs ?? ["."]);
    const cwd = det?.cwd ?? root;

    const commands: Partial<Record<Verb, string>> = {};
    for (const verb of VERBS) {
      const cmd =
        cfg?.commands[verb] ??
        manifest.commands[verb] ??
        (det && adapter ? (adapter.command(verb, det, root) ?? undefined) : undefined);
      if (cmd) commands[verb] = cmd;
    }

    targets.push({
      name,
      dirs,
      affects: cfg?.affects ?? [],
      affectsExcept: cfg?.affectsExcept ?? [],
      cwd,
      commands,
    });
  }

  // A project with neither adapter nor declared targets still gets one implicit
  // target, so project-level `commands` (or a helpful message) still work.
  if (targets.length === 0) {
    const commands: Partial<Record<Verb, string>> = {};
    for (const verb of VERBS) {
      if (manifest.commands[verb]) commands[verb] = manifest.commands[verb];
    }
    targets.push({
      name: manifest.name,
      dirs: ["."],
      affects: [],
      affectsExcept: [],
      cwd: root,
      commands,
    });
  }

  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

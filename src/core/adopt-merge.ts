import type { ProjectManifestInput } from "../manifest/types.js";

// Additive merge for `premo adopt` re-runs: fold the freshly-*detected* draft into
// the *existing* (hand-editable) manifest so a re-adopt picks up newly-detected
// features without ever clobbering what the user already configured. The contract,
// in one line: existing always wins; detection only fills gaps and appends new
// entries. Nothing is removed — entries that are no longer detected are reported
// as `stale` for the caller to surface, but deleting them is the user's call.
//
// We operate on the *raw* existing JSON (not the zod-parsed, default-filled form)
// so the user's file keeps its shape and we touch only what we add. The result is
// idempotent: a second merge with no repo changes reports nothing and is byte-for-
// byte stable.

type Raw = Record<string, unknown>;

// Top-level keys with bespoke merge rules; everything else is "fill if absent".
const SPECIAL = new Set(["commands", "packages", "targets", "environments"]);

export interface AdoptChanges {
  fields: string[]; // top-level keys filled in (adapter, envFile, ports, …)
  commands: string[]; // command verbs added
  packages: string[]; // package names added
  packageFields: string[]; // "pkg.field" sub-fields filled on existing packages
  targets: string[]; // target names added
  targetFields: string[]; // "target.field" sub-fields filled on existing targets
  environments: string[]; // environment names added
}

export interface AdoptStale {
  packages: string[]; // in config, no longer detected
  targets: string[];
}

export interface MergeAdoptResult {
  merged: ProjectManifestInput;
  changes: AdoptChanges;
  stale: AdoptStale;
}

function emptyChanges(): AdoptChanges {
  return {
    fields: [],
    commands: [],
    packages: [],
    packageFields: [],
    targets: [],
    environments: [],
    targetFields: [],
  };
}

export function changesEmpty(c: AdoptChanges): boolean {
  return (
    c.fields.length === 0 &&
    c.commands.length === 0 &&
    c.packages.length === 0 &&
    c.packageFields.length === 0 &&
    c.targets.length === 0 &&
    c.targetFields.length === 0 &&
    c.environments.length === 0
  );
}

// Merge an array of named objects by `name`: keep existing entries (filling any
// sub-field the detected twin has but the existing one lacks), append the rest.
function mergeByName(
  existing: Raw[],
  detected: Raw[],
  addedNames: string[],
  filledFields: string[],
): Raw[] {
  const out = existing.map((o) => ({ ...o }));
  const indexByName = new Map<string, number>();
  out.forEach((o, i) => indexByName.set(String(o.name), i));

  for (const d of detected) {
    const name = String(d.name);
    const i = indexByName.get(name);
    if (i === undefined) {
      out.push({ ...d });
      addedNames.push(name);
      continue;
    }
    const cur = out[i]!;
    for (const [k, v] of Object.entries(d)) {
      if (k === "name" || v === undefined) continue;
      if (!(k in cur)) {
        cur[k] = v;
        filledFields.push(`${name}.${k}`);
      }
    }
  }
  return out;
}

// Names present in `existing` but absent from `detected` — config the repo no
// longer backs. Reported, never auto-removed.
function staleNames(existing: Raw[], detected: Raw[]): string[] {
  const detectedNames = new Set(detected.map((d) => String(d.name)));
  return existing.map((o) => String(o.name)).filter((n) => !detectedNames.has(n));
}

export function mergeAdopt(existing: Raw, detected: ProjectManifestInput): MergeAdoptResult {
  const merged: Raw = { ...existing };
  const changes = emptyChanges();
  const det = detected as Raw;

  // 1. Top-level scalar/object keys: fill only where the existing manifest is
  //    silent. `name`/`version` ride this path too — a re-adopt must never rename.
  for (const [key, val] of Object.entries(det)) {
    if (SPECIAL.has(key) || val === undefined) continue;
    if (!(key in existing)) {
      merged[key] = val;
      // name/version are structural, not "features" — don't list them as changes,
      // but do backfill them if a hand-written manifest omitted them.
      if (key !== "name" && key !== "version") changes.fields.push(key);
    }
  }

  // 2. commands: union of verbs, existing wins.
  const detCommands = (det.commands ?? {}) as Raw;
  if (Object.keys(detCommands).length > 0) {
    const exCommands = (existing.commands ?? {}) as Raw;
    const outCommands: Raw = { ...exCommands };
    for (const [k, v] of Object.entries(detCommands)) {
      if (!(k in exCommands)) {
        outCommands[k] = v;
        changes.commands.push(k);
      }
    }
    if (changes.commands.length > 0) merged.commands = outCommands;
  }

  // 3. packages / targets: merge by name.
  const exPackages = (existing.packages ?? []) as Raw[];
  const detPackages = (det.packages ?? []) as Raw[];
  if (detPackages.length > 0) {
    const mergedPkgs = mergeByName(
      exPackages,
      detPackages,
      changes.packages,
      changes.packageFields,
    );
    if (changes.packages.length > 0 || changes.packageFields.length > 0)
      merged.packages = mergedPkgs;
  }

  const exTargets = (existing.targets ?? []) as Raw[];
  const detTargets = (det.targets ?? []) as Raw[];
  if (detTargets.length > 0) {
    // Targets always get a fresh, copied array even when names are unchanged:
    // port reconciliation mutates it downstream and must not bleed into the
    // original existing object the caller diffs against.
    const mergedTargets = mergeByName(exTargets, detTargets, changes.targets, changes.targetFields);
    merged.targets = mergedTargets;
  }

  // 4. environments: union by name, existing flags (default/deploy) preserved.
  const exEnvs = (existing.environments ?? []) as Raw[];
  const detEnvs = (det.environments ?? []) as Raw[];
  if (detEnvs.length > 0) {
    const names = new Set(exEnvs.map((e) => String(e.name)));
    const outEnvs = exEnvs.map((e) => ({ ...e }));
    for (const e of detEnvs) {
      if (!names.has(String(e.name))) {
        outEnvs.push({ ...e });
        changes.environments.push(String(e.name));
        names.add(String(e.name));
      }
    }
    if (changes.environments.length > 0) merged.environments = outEnvs;
  }

  const stale: AdoptStale = {
    packages: detPackages.length > 0 ? staleNames(exPackages, detPackages) : [],
    targets: detTargets.length > 0 ? staleNames(exTargets, detTargets) : [],
  };

  return { merged: merged as ProjectManifestInput, changes, stale };
}

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StrandManifest } from "../strand-api/types.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STRANDS_ROOT = path.resolve(DIR, "../../strands");

export interface LoadedStrand {
  manifest: StrandManifest;
  dir: string;
}

export async function listAvailableStrands(): Promise<string[]> {
  if (!existsSync(STRANDS_ROOT)) return [];
  const entries = await readdir(STRANDS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function loadStrand(name: string): Promise<LoadedStrand> {
  const dir = path.join(STRANDS_ROOT, name);
  const manifestPath = path.join(dir, "strand.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Strand "${name}" not found (looked in ${dir})`);
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = StrandManifest.parse(raw);
  if (manifest.name !== name) {
    throw new Error(`Strand directory "${name}" but manifest says "${manifest.name}"`);
  }
  return { manifest, dir };
}

export async function resolveStrandSet(requested: string[]): Promise<LoadedStrand[]> {
  const loaded = new Map<string, LoadedStrand>();
  const visiting = new Set<string>();

  async function visit(name: string, requestedBy: string | null): Promise<void> {
    if (loaded.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Strand dependency cycle involving "${name}"`);
    }
    visiting.add(name);
    let strand: LoadedStrand;
    try {
      strand = await loadStrand(name);
    } catch (e) {
      const ctx = requestedBy ? ` (required by "${requestedBy}")` : "";
      throw new Error((e as Error).message + ctx);
    }
    for (const dep of strand.manifest.dependsOn) {
      await visit(dep, name);
    }
    visiting.delete(name);
    loaded.set(name, strand);
  }

  for (const name of requested) await visit(name, null);
  return Array.from(loaded.values());
}

export function strandsRoot(): string {
  return STRANDS_ROOT;
}

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ProjectManifest, type ProjectManifestInput } from "../premo-api/types.js";

export const PROJECT_FILE = "premo.json";

export async function loadProject(dir: string): Promise<ProjectManifest> {
  const file = path.join(dir, PROJECT_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${PROJECT_FILE} found in ${dir}`);
  }
  const raw = JSON.parse(await readFile(file, "utf8"));
  return ProjectManifest.parse(raw);
}

export async function loadProjectIfExists(dir: string): Promise<ProjectManifest | null> {
  const file = path.join(dir, PROJECT_FILE);
  if (!existsSync(file)) return null;
  return loadProject(dir);
}

export async function saveProject(dir: string, manifest: ProjectManifestInput): Promise<void> {
  const file = path.join(dir, PROJECT_FILE);
  await writeFile(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

// Sanitize an arbitrary directory/package name into the kebab-case the
// manifest's `name` field (and Docker/compose project names) require.
export function sanitizeProjectName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[/]/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "");
  return cleaned || "project";
}

export function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, PROJECT_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

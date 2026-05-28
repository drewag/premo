import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ProjectManifest } from "../strand-api/types.js";

export const PROJECT_FILE = "strand.json";

export async function loadProject(dir: string): Promise<ProjectManifest> {
  const file = path.join(dir, PROJECT_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${PROJECT_FILE} found in ${dir}`);
  }
  const raw = JSON.parse(await readFile(file, "utf8"));
  return ProjectManifest.parse(raw);
}

export async function saveProject(dir: string, manifest: ProjectManifest): Promise<void> {
  const file = path.join(dir, PROJECT_FILE);
  await writeFile(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
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

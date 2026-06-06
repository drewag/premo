import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { ProjectManifest, type ProjectManifestInput } from "../manifest/types.js";

export const PROJECT_FILE = "premo.json";

export async function loadProject(dir: string): Promise<ProjectManifest> {
  const file = path.join(dir, PROJECT_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${PROJECT_FILE} found in ${dir}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`${PROJECT_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  try {
    return ProjectManifest.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const issues = e.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`${PROJECT_FILE} is invalid:\n${issues}`);
    }
    throw e;
  }
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

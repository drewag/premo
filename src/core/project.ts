import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { ProjectManifest, type Environment, type ProjectManifestInput } from "../manifest/types.js";

export const PROJECT_FILE = "premo.json";

// Fold a pre-§15 `deploy.envs` list into the `environments` axis (DESIGN §15.2).
// In-memory only — the rewrite to disk lands the next time `premo adopt` saves.
// Only kicks in when the modern `environments` block is absent, so a hand-edited
// or re-adopted manifest is authoritative.
export function migrateEnvironments(m: ProjectManifest): ProjectManifest {
  if (m.environments.length > 0 || !m.deploy?.envs?.length) return m;
  const environments: Environment[] = m.deploy.envs.map((name, i) => ({
    name,
    deploy: true,
    ...(i === 0 ? { default: true } : {}),
  }));
  return { ...m, environments };
}

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
  // Pre-split configs keyed `targets` as an object (the build/test/lint unit);
  // that concept is now `packages` (an array). The shapes are distinguishable —
  // a non-array `targets` means a stale config. (DESIGN §13.)
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "targets" in raw &&
    !Array.isArray((raw as Record<string, unknown>).targets)
  ) {
    throw new Error(
      `${PROJECT_FILE} predates the package/target split (\`targets\` is now \`packages\`). ` +
        `Run \`premo adopt\` to regenerate it.`,
    );
  }
  try {
    return migrateEnvironments(ProjectManifest.parse(raw));
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

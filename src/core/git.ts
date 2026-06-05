import { execa } from "execa";

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execa("git", args, { cwd });
    return stdout;
  } catch {
    return null;
  }
}

export async function gitRoot(cwd: string): Promise<string | null> {
  const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return out?.trim() || null;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await gitRoot(cwd)) !== null;
}

async function refExists(root: string, ref: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "--quiet", ref])) !== null;
}

// Resolve the diff base, trying the configured ref then sensible fallbacks.
// Returns null when none exist (e.g. a brand-new repo with no main branch).
export async function resolveBase(root: string, configured: string): Promise<string | null> {
  for (const ref of [configured, "origin/main", "origin/HEAD", "main", "master"]) {
    if (await refExists(root, ref)) return ref;
  }
  return null;
}

async function mergeBase(root: string, base: string): Promise<string | null> {
  const out = await git(root, ["merge-base", base, "HEAD"]);
  return out?.trim() || null;
}

function parsePorcelain(out: string): string[] {
  const files: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const rest = line.slice(3); // strip "XY "
    const arrow = rest.indexOf(" -> ");
    files.push(arrow >= 0 ? rest.slice(arrow + 4) : rest);
  }
  return files;
}

export interface ChangedFiles {
  files: string[];
  base: string | null; // the base used, or null if only the working tree was inspected
}

// Files changed on this branch (merge-base..HEAD) plus the dirty working tree.
// See DESIGN.md §4. Paths are relative to the repo root.
export async function changedFiles(root: string, configuredBase: string): Promise<ChangedFiles> {
  const set = new Set<string>();

  const base = await resolveBase(root, configuredBase);
  if (base) {
    const mb = await mergeBase(root, base);
    if (mb) {
      const committed = await git(root, ["diff", "--name-only", `${mb}..HEAD`]);
      if (committed) for (const f of committed.split("\n")) if (f.trim()) set.add(f.trim());
    }
  }

  const status = await git(root, ["status", "--porcelain"]);
  if (status) for (const f of parsePorcelain(status)) set.add(f);

  return { files: [...set], base };
}

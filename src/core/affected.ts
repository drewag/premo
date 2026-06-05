import type { Target } from "./targets.js";

function underDir(file: string, dir: string): boolean {
  if (dir === "." || dir === "./") return true;
  const d = dir.endsWith("/") ? dir : `${dir}/`;
  return file === d.slice(0, -1) || file.startsWith(d);
}

// Map changed files to the set of affected target names. A file under a
// target's `dirs` marks it directly; that target's `affects` then fan out,
// unless every change under it is covered by `affectsExcept`. See DESIGN.md §4.
export function affectedTargets(files: string[], targets: Target[]): Set<string> {
  const result = new Set<string>();

  for (const t of targets) {
    if (files.some((f) => t.dirs.some((d) => underDir(f, d)))) result.add(t.name);
  }

  for (const t of targets) {
    if (!result.has(t.name) || t.affects.length === 0) continue;
    const changedUnder = files.filter((f) => t.dirs.some((d) => underDir(f, d)));
    const meaningful = changedUnder.some((f) => !t.affectsExcept.some((ex) => underDir(f, ex)));
    if (meaningful) for (const other of t.affects) result.add(other);
  }

  return result;
}

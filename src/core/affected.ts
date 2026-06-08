import type { Package } from "./packages.js";

function underDir(file: string, dir: string): boolean {
  if (dir === "." || dir === "./") return true;
  const d = dir.endsWith("/") ? dir : `${dir}/`;
  return file === d.slice(0, -1) || file.startsWith(d);
}

// Map changed files to the set of affected package names. A file under a
// package's `dirs` marks it directly; that package's `affects` then fan out,
// unless every change under it is covered by `affectsExcept`. See DESIGN.md §4.
export function affectedPackages(files: string[], packages: Package[]): Set<string> {
  const result = new Set<string>();

  for (const p of packages) {
    if (files.some((f) => p.dirs.some((d) => underDir(f, d)))) result.add(p.name);
  }

  for (const p of packages) {
    if (!result.has(p.name) || p.affects.length === 0) continue;
    const changedUnder = files.filter((f) => p.dirs.some((d) => underDir(f, d)));
    const meaningful = changedUnder.some((f) => !p.affectsExcept.some((ex) => underDir(f, ex)));
    if (meaningful) for (const other of p.affects) result.add(other);
  }

  return result;
}

import { execa } from "execa";

// Deploy version scheme (mirrors ~/git/personal/email): `YYYY.MM.DD.N`, where N
// is a per-day counter derived from existing `release/*/<date>.N` tags. One
// version per deploy run, shared across targets.

export function todayStamp(date = new Date()): string {
  return date.toLocaleDateString("en-CA").replace(/-/g, "."); // en-CA → YYYY-MM-DD
}

// Pure: given the existing release tags and today's stamp, the next version.
export function nextVersionFromTags(tags: string[], today: string): string {
  let max = 0;
  for (const raw of tags) {
    const parts = raw.trim().split("/"); // release / <target> / YYYY.MM.DD.N
    if (parts.length < 3) continue;
    const segs = parts[2]!.split(".");
    if (segs.length === 4 && segs.slice(0, 3).join(".") === today) {
      const n = parseInt(segs[3]!, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${today}.${max + 1}`;
}

export async function nextVersion(root: string): Promise<string> {
  const today = todayStamp();
  const { stdout } = await execa("git", ["tag", "-l", `release/*/${today}.*`], {
    cwd: root,
    reject: false,
  });
  const tags = stdout.split("\n").filter(Boolean);
  return nextVersionFromTags(tags, today);
}

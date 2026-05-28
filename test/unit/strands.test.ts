import { describe, expect, it } from "vitest";
import { listAvailableStrands, loadStrand, resolveStrandSet } from "../../src/core/strands.js";

describe("strand discovery", () => {
  it("lists the four MVP strands", async () => {
    const names = await listAvailableStrands();
    expect(names).toEqual(expect.arrayContaining(["shared", "db", "backend", "web-app"]));
  });

  it("loads a manifest", async () => {
    const s = await loadStrand("backend");
    expect(s.manifest.name).toBe("backend");
    expect(s.manifest.dependsOn).toContain("shared");
  });

  it("throws on unknown strand", async () => {
    await expect(loadStrand("does-not-exist")).rejects.toThrow(/not found/);
  });
});

describe("resolveStrandSet", () => {
  it("pulls in transitive deps", async () => {
    const resolved = await resolveStrandSet(["backend"]);
    const names = resolved.map((r) => r.manifest.name);
    expect(names).toContain("shared");
    expect(names).toContain("backend");
    expect(names.indexOf("shared")).toBeLessThan(names.indexOf("backend"));
  });

  it("dedupes when multiple strands share a dep", async () => {
    const resolved = await resolveStrandSet(["backend", "web-app"]);
    const counts = resolved.reduce<Record<string, number>>((acc, r) => {
      acc[r.manifest.name] = (acc[r.manifest.name] ?? 0) + 1;
      return acc;
    }, {});
    for (const c of Object.values(counts)) expect(c).toBe(1);
  });
});

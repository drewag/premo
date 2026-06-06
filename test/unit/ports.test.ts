import { describe, expect, it } from "vitest";
import {
  defaultBaseForProject,
  DEFAULT_BASE_MAX,
  DEFAULT_BASE_MIN,
  DEFAULT_BLOCK,
} from "../../src/core/ports.js";

describe("defaultBaseForProject", () => {
  it("lands in the configured range, aligned to the block size", () => {
    for (const name of ["myapp", "foo", "demoapp", "long-named-project-x"]) {
      const base = defaultBaseForProject(name);
      expect(base).toBeGreaterThanOrEqual(DEFAULT_BASE_MIN);
      expect(base).toBeLessThan(DEFAULT_BASE_MAX);
      expect(base % DEFAULT_BLOCK).toBe(0);
    }
  });

  it("is deterministic", () => {
    expect(defaultBaseForProject("stable")).toBe(defaultBaseForProject("stable"));
  });

  it("usually differs across distinct names", () => {
    const samples = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(defaultBaseForProject);
    expect(new Set(samples).size).toBeGreaterThanOrEqual(8);
  });
});

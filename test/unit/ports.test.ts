import { describe, expect, it } from "vitest";
import {
  allocatePorts,
  defaultBaseForProject,
  DEFAULT_BASE_MAX,
  DEFAULT_BASE_MIN,
  DEFAULT_BLOCK,
} from "../../src/core/ports.js";
import type { StrandManifest } from "../../src/strand-api/types.js";

function strand(name: string, ports: { name: string; offset: number }[]): StrandManifest {
  return {
    name,
    version: "0",
    description: "",
    dependsOn: [],
    softDependsOn: [],
    ports,
    skills: [],
  };
}

describe("allocatePorts", () => {
  it("allocates ports at base + offset", () => {
    const result = allocatePorts(4000, 100, [
      strand("a", [{ name: "A_PORT", offset: 0 }]),
      strand("b", [{ name: "B_PORT", offset: 10 }]),
    ]);
    expect(result).toEqual({ A_PORT: 4000, B_PORT: 4010 });
  });

  it("rejects offset collisions across strands", () => {
    expect(() =>
      allocatePorts(4000, 100, [
        strand("a", [{ name: "A", offset: 5 }]),
        strand("b", [{ name: "B", offset: 5 }]),
      ]),
    ).toThrow(/collides/);
  });

  it("rejects offsets >= block size", () => {
    expect(() => allocatePorts(4000, 100, [strand("a", [{ name: "A", offset: 100 }])])).toThrow(
      /exceeds block size/,
    );
  });

  it("refuses bases that hit the AirPlay range", () => {
    expect(() => allocatePorts(5050, 100, [strand("a", [{ name: "A", offset: 0 }])])).toThrow(
      /AirPlay/,
    );
  });

  it("returns empty when no strand declares ports", () => {
    expect(allocatePorts(4000, 100, [strand("a", [])])).toEqual({});
  });
});

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

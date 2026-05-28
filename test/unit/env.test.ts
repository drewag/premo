import { describe, expect, it } from "vitest";
import { interpolateArgv, interpolateEnv } from "../../src/core/env.js";

describe("interpolateEnv", () => {
  it("replaces ${VAR} tokens", () => {
    expect(interpolateEnv("http://localhost:${PORT}/x", { PORT: 4010 })).toBe(
      "http://localhost:4010/x",
    );
  });

  it("supports multiple tokens", () => {
    expect(interpolateEnv("${A}-${B}", { A: "x", B: "y" })).toBe("x-y");
  });

  it("throws on missing var", () => {
    expect(() => interpolateEnv("${MISSING}", {})).toThrow(/MISSING/);
  });

  it("leaves non-token text untouched", () => {
    expect(interpolateEnv("plain string", { A: "1" })).toBe("plain string");
  });

  it("ignores tokens that don't match the SCREAMING_SNAKE pattern", () => {
    expect(interpolateEnv("${lowercase} stays", { lowercase: "x" })).toBe("${lowercase} stays");
  });
});

describe("interpolateArgv", () => {
  it("interpolates each argv element", () => {
    expect(interpolateArgv(["psql", "-p", "${PORT}"], { PORT: 5432 })).toEqual([
      "psql",
      "-p",
      "5432",
    ]);
  });
});

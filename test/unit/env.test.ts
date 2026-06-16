import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  interpolateArgv,
  interpolateEnv,
  loadEnvFile,
  gapFill,
  envFileVars,
  configEnv,
} from "../../src/core/env.js";

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

describe("loadEnvFile", () => {
  async function withEnv(contents: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-env-"));
    await writeFile(path.join(dir, ".env"), contents);
    return dir;
  }

  it("parses KEY=VALUE, strips quotes, honors export, ignores comments/blanks", async () => {
    const dir = await withEnv(
      [
        "# comment",
        "",
        "FOO=bar",
        'QUOTED="hello world"',
        "SINGLE='x y'",
        "export EXP=z",
        "EMPTY=",
        "no_equals_here",
      ].join("\n"),
    );
    expect(await loadEnvFile(dir, ".env")).toEqual({
      FOO: "bar",
      QUOTED: "hello world",
      SINGLE: "x y",
      EXP: "z",
      EMPTY: "",
    });
  });

  it("returns {} for no file configured or a missing file", async () => {
    const dir = await withEnv("X=1");
    expect(await loadEnvFile(dir, undefined)).toEqual({});
    expect(await loadEnvFile(dir, ".env.missing")).toEqual({});
  });
});

describe("gapFill / envFileVars", () => {
  it("gapFill drops keys already in the real environment", () => {
    // PATH is reliably set; a random key is not.
    expect(gapFill({ PATH: "x", PREMO_TEST_UNSET_KEY: "y" })).toEqual({
      PREMO_TEST_UNSET_KEY: "y",
    });
  });

  it("envFileVars returns the gap-fill set from the file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-env-"));
    await writeFile(path.join(dir, ".env"), "PREMO_TEST_FROM_FILE=yes\nPATH=should-not-win\n");
    const vars = await envFileVars(dir, ".env");
    expect(vars.PREMO_TEST_FROM_FILE).toBe("yes");
    expect(vars.PATH).toBeUndefined(); // real PATH wins
  });

  it("layers a per-environment overlay (.env.<env>) over the base, overlay winning", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "premo-env-"));
    await writeFile(path.join(dir, ".env"), "PREMO_TEST_SHARED=base\nPREMO_TEST_PLAID=sandbox\n");
    await writeFile(path.join(dir, ".env.production"), "PREMO_TEST_PLAID=production\n");

    const base = await envFileVars(dir, ".env");
    expect(base.PREMO_TEST_PLAID).toBe("sandbox"); // no env ⇒ base only

    const prod = await envFileVars(dir, ".env", "production");
    expect(prod.PREMO_TEST_PLAID).toBe("production"); // overlay wins
    expect(prod.PREMO_TEST_SHARED).toBe("base"); // base shows through

    // an env with no overlay file falls back to the base values
    const missing = await envFileVars(dir, ".env", "staging");
    expect(missing.PREMO_TEST_PLAID).toBe("sandbox");
  });
});

describe("configEnv — envFile < project env < package env", () => {
  it("layers the inline envs over the file, package winning over project", () => {
    const fileVars = { A: "file", B: "file", C: "file" };
    const out = configEnv(fileVars, { B: "project", D: "project" }, { C: "package", E: "package" });
    expect(out).toEqual({
      A: "file", // file only
      B: "project", // project overrides file
      C: "package", // package overrides file
      D: "project", // project only
      E: "package", // package only
    });
  });

  it("gap-fills the inline layers so an exported shell var still wins", () => {
    // PATH is reliably exported; an inline env must NOT shadow it.
    const out = configEnv({}, { PATH: "project-tries" }, { PATH: "package-tries" });
    expect(out.PATH).toBeUndefined(); // dropped by gapFill → real PATH wins downstream
  });

  it("handles absent inline layers (undefined) as no-ops", () => {
    expect(configEnv({ A: "file" }, undefined, undefined)).toEqual({ A: "file" });
  });
});

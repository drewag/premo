import { describe, it, expect } from "vitest";
import { ProjectManifest } from "../../src/manifest/types.js";
import {
  defaultEnvName,
  deployableEnvNames,
  pickXcodeEnv,
  resolveEnvName,
} from "../../src/manifest/environments.js";
import { migrateEnvironments } from "../../src/core/project.js";
import { deriveEnvNames } from "../../src/core/adapters/xcode.js";

// The environments axis (DESIGN §15).

describe("defaultEnvName", () => {
  it("returns the env flagged default", () => {
    expect(defaultEnvName([{ name: "dev" }, { name: "prod", default: true }])).toBe("prod");
  });
  it("falls back to the first when none is flagged", () => {
    expect(defaultEnvName([{ name: "dev" }, { name: "prod" }])).toBe("dev");
  });
  it("is null for a project with no environments (the single implicit env)", () => {
    expect(defaultEnvName([])).toBeNull();
  });
});

describe("resolveEnvName", () => {
  const envs = [
    { name: "dev", default: true },
    { name: "prod", deploy: true },
  ];
  it("uses the default env when no flag is given", () => {
    expect(resolveEnvName(envs, undefined)).toBe("dev");
    expect(resolveEnvName(envs, null)).toBe("dev");
  });
  it("passes through a declared env", () => {
    expect(resolveEnvName(envs, "prod")).toBe("prod");
  });
  it("throws on an unknown env (a typo fails loudly)", () => {
    expect(() => resolveEnvName(envs, "prdo")).toThrow(/Unknown environment "prdo"/);
  });
  it("accepts any name when no environments are declared (single implicit env)", () => {
    expect(resolveEnvName([], undefined)).toBeNull();
  });
});

describe("deployableEnvNames", () => {
  it("returns only the deploy-flagged envs", () => {
    const envs = [
      { name: "dev", default: true },
      { name: "staging", deploy: true },
      { name: "prod", deploy: true },
    ];
    expect(deployableEnvNames(envs)).toEqual(["staging", "prod"]);
  });
  it("is empty when none are flagged (deploy falls back to a single implicit env)", () => {
    expect(deployableEnvNames([{ name: "dev", default: true }])).toEqual([]);
  });
});

describe("pickXcodeEnv", () => {
  it("returns the bare pair (env-agnostic) when there's no per-env map", () => {
    const xcode = { project: "App.xcodeproj", scheme: "App", bundleId: "com.x.app" };
    expect(pickXcodeEnv(xcode, "prod")).toEqual({ scheme: "App", bundleId: "com.x.app" });
    expect(pickXcodeEnv(xcode, null)).toEqual({ scheme: "App", bundleId: "com.x.app" });
  });
  it("selects the active env's scheme/bundleId from a per-env map", () => {
    const xcode = {
      project: "Chess.xcodeproj",
      environments: {
        dev: { scheme: "Chess Dev", bundleId: "do.odo.chess.dev" },
        prod: { scheme: "Chess Prod", bundleId: "do.odo.chess" },
      },
    };
    expect(pickXcodeEnv(xcode, "prod")).toEqual({ scheme: "Chess Prod", bundleId: "do.odo.chess" });
    expect(pickXcodeEnv(xcode, "dev")).toEqual({
      scheme: "Chess Dev",
      bundleId: "do.odo.chess.dev",
    });
  });
  it("throws when a per-env map lacks the active env (a real misconfig)", () => {
    const xcode = {
      project: "Chess.xcodeproj",
      environments: { dev: { scheme: "Chess Dev" } },
    };
    expect(() => pickXcodeEnv(xcode, "prod")).toThrow(/no "prod" environment.*has: dev/);
  });
});

describe("migrateEnvironments", () => {
  it("folds a legacy deploy.envs list into the environments axis", () => {
    const m = ProjectManifest.parse({ name: "app", deploy: { envs: ["staging", "prod"] } });
    const out = migrateEnvironments(m);
    expect(out.environments).toEqual([
      { name: "staging", deploy: true, default: true },
      { name: "prod", deploy: true },
    ]);
    expect(deployableEnvNames(out.environments)).toEqual(["staging", "prod"]);
  });
  it("leaves a manifest with an explicit environments block untouched", () => {
    const m = ProjectManifest.parse({
      name: "app",
      environments: [{ name: "dev", default: true }],
      deploy: { envs: ["prod"] },
    });
    expect(migrateEnvironments(m).environments).toEqual([{ name: "dev", default: true }]);
  });
  it("is a no-op when there's neither environments nor deploy.envs", () => {
    const m = ProjectManifest.parse({ name: "app" });
    expect(migrateEnvironments(m).environments).toEqual([]);
  });
});

describe("deriveEnvNames", () => {
  it("strips a shared prefix from spaced scheme names", () => {
    const map = deriveEnvNames(["Chess Dev", "Chess Prod"]);
    expect(map.get("Chess Dev")).toBe("dev");
    expect(map.get("Chess Prod")).toBe("prod");
  });
  it("strips a shared prefix from camelCase scheme names", () => {
    const map = deriveEnvNames(["ChessDev", "ChessProd"]);
    expect(map.get("ChessDev")).toBe("dev");
    expect(map.get("ChessProd")).toBe("prod");
  });
  it("falls back to the sanitized scheme when there's no shared prefix", () => {
    const map = deriveEnvNames(["Alpha", "Beta"]);
    expect(map.get("Alpha")).toBe("alpha");
    expect(map.get("Beta")).toBe("beta");
  });
  it("disambiguates collisions", () => {
    // Both sanitize to the same base once the shared prefix is stripped.
    const map = deriveEnvNames(["App (Dev)", "App [Dev]"]);
    const names = [...map.values()];
    expect(new Set(names).size).toBe(names.length);
  });
});

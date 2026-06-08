import { describe, expect, it } from "vitest";
import { affectedPackages } from "../../src/core/affected.js";
import type { Package } from "../../src/core/packages.js";

function t(name: string, dirs: string[], extra: Partial<Package> = {}): Package {
  return {
    name,
    dirs,
    affects: [],
    affectsExcept: [],
    cwd: ".",
    commands: {},
    kind: "service",
    ...extra,
  };
}

describe("affectedPackages", () => {
  const packages = [
    t("frontend", ["frontend/"]),
    t("backend", ["backend/", "react-email/"]),
    t("shared", ["shared/"], { affects: ["frontend", "backend"], affectsExcept: ["shared/api/"] }),
  ];

  it("maps a file to its owning target", () => {
    expect(affectedPackages(["frontend/app.ts"], packages)).toEqual(new Set(["frontend"]));
  });

  it("maps secondary dirs (react-email → backend)", () => {
    expect(affectedPackages(["react-email/x.tsx"], packages)).toEqual(new Set(["backend"]));
  });

  it("fans out via affects", () => {
    expect(affectedPackages(["shared/util.ts"], packages)).toEqual(
      new Set(["shared", "frontend", "backend"]),
    );
  });

  it("suppresses fan-out for affectsExcept paths", () => {
    // Only a type-only change under shared/api/ → shared itself, no fan-out.
    expect(affectedPackages(["shared/api/routes.ts"], packages)).toEqual(new Set(["shared"]));
  });

  it("fans out when at least one change is meaningful", () => {
    expect(affectedPackages(["shared/api/routes.ts", "shared/util.ts"], packages)).toEqual(
      new Set(["shared", "frontend", "backend"]),
    );
  });

  it("returns empty for files under no target", () => {
    expect(affectedPackages(["README.md", "premo.json"], packages)).toEqual(new Set());
  });

  it("treats a '.' dir as owning everything", () => {
    expect(affectedPackages(["anything/x"], [t("root", ["."])])).toEqual(new Set(["root"]));
  });
});

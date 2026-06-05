import { describe, expect, it } from "vitest";
import { affectedTargets } from "../../src/core/affected.js";
import type { Target } from "../../src/core/targets.js";

function t(name: string, dirs: string[], extra: Partial<Target> = {}): Target {
  return { name, dirs, affects: [], affectsExcept: [], cwd: ".", commands: {}, ...extra };
}

describe("affectedTargets", () => {
  const targets = [
    t("frontend", ["frontend/"]),
    t("backend", ["backend/", "react-email/"]),
    t("shared", ["shared/"], { affects: ["frontend", "backend"], affectsExcept: ["shared/api/"] }),
  ];

  it("maps a file to its owning target", () => {
    expect(affectedTargets(["frontend/app.ts"], targets)).toEqual(new Set(["frontend"]));
  });

  it("maps secondary dirs (react-email → backend)", () => {
    expect(affectedTargets(["react-email/x.tsx"], targets)).toEqual(new Set(["backend"]));
  });

  it("fans out via affects", () => {
    expect(affectedTargets(["shared/util.ts"], targets)).toEqual(
      new Set(["shared", "frontend", "backend"]),
    );
  });

  it("suppresses fan-out for affectsExcept paths", () => {
    // Only a type-only change under shared/api/ → shared itself, no fan-out.
    expect(affectedTargets(["shared/api/routes.ts"], targets)).toEqual(new Set(["shared"]));
  });

  it("fans out when at least one change is meaningful", () => {
    expect(affectedTargets(["shared/api/routes.ts", "shared/util.ts"], targets)).toEqual(
      new Set(["shared", "frontend", "backend"]),
    );
  });

  it("returns empty for files under no target", () => {
    expect(affectedTargets(["README.md", "strand.json"], targets)).toEqual(new Set());
  });

  it("treats a '.' dir as owning everything", () => {
    expect(affectedTargets(["anything/x"], [t("root", ["."])])).toEqual(new Set(["root"]));
  });
});

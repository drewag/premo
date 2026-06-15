import { describe, expect, it } from "vitest";
import { mergeAdopt, changesEmpty } from "../../src/core/adopt-merge.js";
import type { ProjectManifestInput } from "../../src/manifest/types.js";

// A freshly-detected draft, in the shape detectDraft produces (targets carry no
// ports yet — those are reconciled separately).
function detected(over: Partial<ProjectManifestInput> = {}): ProjectManifestInput {
  return {
    name: "app",
    version: "0",
    adapter: "monorepo",
    packages: [
      { name: "api", dirs: ["api/"] },
      { name: "web", dirs: ["web/"] },
    ],
    targets: [
      { name: "api", packages: ["api"], deploy: "yarn deploy:api" },
      { name: "web", packages: ["web"] },
    ],
    ...over,
  };
}

describe("mergeAdopt — additive sync", () => {
  it("is a no-op when the existing manifest already covers everything detected", () => {
    const existing = {
      name: "app",
      version: "0",
      adapter: "monorepo",
      packages: [
        { name: "api", dirs: ["api/"] },
        { name: "web", dirs: ["web/"] },
      ],
      targets: [
        { name: "api", packages: ["api"], deploy: "yarn deploy:api" },
        { name: "web", packages: ["web"] },
      ],
    };
    const { changes } = mergeAdopt(existing, detected());
    expect(changesEmpty(changes)).toBe(true);
  });

  it("never overrides an existing value, even when detection differs", () => {
    const existing = {
      name: "renamed-by-hand",
      adapter: "monorepo",
      packages: [{ name: "api", dirs: ["services/api/"] }], // user moved the dir
    };
    const { merged } = mergeAdopt(existing, detected());
    expect(merged.name).toBe("renamed-by-hand");
    const api = merged.packages!.find((p) => p.name === "api")!;
    expect(api.dirs).toEqual(["services/api/"]); // detection's ["api/"] ignored
  });

  it("appends a newly-detected package and target", () => {
    const existing = {
      name: "app",
      adapter: "monorepo",
      packages: [{ name: "api", dirs: ["api/"] }],
      targets: [{ name: "api", packages: ["api"], deploy: "yarn deploy:api" }],
    };
    const { merged, changes } = mergeAdopt(existing, detected());
    expect(changes.packages).toEqual(["web"]);
    expect(changes.targets).toEqual(["web"]);
    expect(merged.packages!.map((p) => p.name)).toEqual(["api", "web"]);
    expect(merged.targets!.map((t) => t.name)).toEqual(["api", "web"]);
  });

  it("fills a missing sub-field on an existing entry without disturbing the rest", () => {
    const existing = {
      name: "app",
      adapter: "monorepo",
      packages: [{ name: "app", dirs: ["."] }], // no xcode block yet
    };
    const det = detected({
      packages: [{ name: "app", dirs: ["."], xcode: { scheme: "App" } }],
      targets: [],
    });
    const { merged, changes } = mergeAdopt(existing, det);
    const app = merged.packages!.find((p) => p.name === "app")!;
    expect(app.xcode).toEqual({ scheme: "App" });
    expect(changes.packageFields).toContain("app.xcode");
  });

  it("fills a top-level key only when the existing manifest is silent", () => {
    const existing = { name: "app", adapter: "monorepo", packages: [] };
    const det = detected({ envFile: ".env", packages: [], targets: [] });
    const { merged, changes } = mergeAdopt(existing, det);
    expect(merged.envFile).toBe(".env");
    expect(changes.fields).toContain("envFile");

    // A user who disabled it (explicit null) is respected.
    const optedOut = { name: "app", adapter: "monorepo", packages: [], envFile: null };
    const second = mergeAdopt(optedOut, det);
    expect(second.merged.envFile).toBeNull();
    expect(second.changes.fields).not.toContain("envFile");
  });

  it("unions commands and environments by key, existing winning", () => {
    const existing = {
      name: "app",
      packages: [],
      commands: { dev: "my-custom-dev" },
      environments: [{ name: "dev", default: true }],
    };
    const det = detected({
      packages: [],
      targets: [],
      commands: { dev: "node .", build: "tsc" },
      environments: [
        { name: "dev", default: true },
        { name: "prod", deploy: true },
      ],
    });
    const { merged, changes } = mergeAdopt(existing, det);
    expect(merged.commands).toEqual({ dev: "my-custom-dev", build: "tsc" });
    expect(changes.commands).toEqual(["build"]);
    expect(merged.environments!.map((e) => e.name)).toEqual(["dev", "prod"]);
    expect(changes.environments).toEqual(["prod"]);
  });

  it("reports entries that are no longer detected as stale (but keeps them)", () => {
    const existing = {
      name: "app",
      adapter: "monorepo",
      packages: [
        { name: "api", dirs: ["api/"] },
        { name: "legacy", dirs: ["legacy/"] },
      ],
      targets: [{ name: "legacy", packages: ["legacy"] }],
    };
    const { merged, stale } = mergeAdopt(existing, detected());
    expect(stale.packages).toEqual(["legacy"]);
    expect(stale.targets).toEqual(["legacy"]);
    // Kept, not removed.
    expect(merged.packages!.map((p) => p.name)).toContain("legacy");
  });
});

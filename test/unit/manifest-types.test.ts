import { describe, expect, it } from "vitest";
import { ProjectManifest } from "../../src/manifest/types.js";

// The Zod manifest schema (src/manifest/types.ts) — validation, defaults, and
// the per-block refinements. Every field is optional/additive; `name` is the
// only required field.

describe("ProjectManifest name regex", () => {
  it("accepts a lowercase kebab name", () => {
    expect(ProjectManifest.parse({ name: "my-app" }).name).toBe("my-app");
  });

  it("rejects uppercase / underscores", () => {
    expect(ProjectManifest.safeParse({ name: "My_App" }).success).toBe(false);
  });

  it("rejects a leading digit", () => {
    expect(ProjectManifest.safeParse({ name: "1app" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(ProjectManifest.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("ProjectManifest defaults on parse", () => {
  it("fills the documented defaults", () => {
    const m = ProjectManifest.parse({ name: "app" });
    expect(m.version).toBe("0");
    expect(m.shells).toEqual({});
    expect(m.commands).toEqual({});
    expect(m.packages).toEqual([]);
    expect(m.targets).toEqual([]);
    expect(m.environments).toEqual([]);
    expect(m.changeBase).toBe("origin/main");
  });

  it("fills PackageConfig defaults (dirs/affects/affectsExcept/commands)", () => {
    const m = ProjectManifest.parse({ name: "app", packages: [{ name: "web" }] });
    const pkg = m.packages[0]!;
    expect(pkg.dirs).toEqual([]);
    expect(pkg.affects).toEqual([]);
    expect(pkg.affectsExcept).toEqual([]);
    expect(pkg.commands).toEqual({});
  });
});

describe("XcodeConfig refine", () => {
  it("rejects a block with neither scheme nor a non-empty environments map", () => {
    expect(
      ProjectManifest.safeParse({ name: "app", xcode: { project: "App.xcodeproj" } }).success,
    ).toBe(false);
  });

  it("rejects an empty environments map (with no scheme)", () => {
    expect(
      ProjectManifest.safeParse({
        name: "app",
        xcode: { project: "App.xcodeproj", environments: {} },
      }).success,
    ).toBe(false);
  });

  it("accepts a bare scheme", () => {
    const m = ProjectManifest.parse({
      name: "app",
      xcode: { project: "App.xcodeproj", scheme: "App" },
    });
    expect(m.xcode!.scheme).toBe("App");
  });

  it("accepts a non-empty environments map without a scheme", () => {
    const m = ProjectManifest.parse({
      name: "app",
      xcode: {
        project: "App.xcodeproj",
        environments: { dev: { scheme: "App Dev" }, prod: { scheme: "App Prod" } },
      },
    });
    expect(Object.keys(m.xcode!.environments!)).toEqual(["dev", "prod"]);
  });
});

describe("ShellSpec refine", () => {
  it("rejects kind 'compose-exec' without a service", () => {
    expect(
      ProjectManifest.safeParse({
        name: "app",
        shells: { db: { kind: "compose-exec", command: ["psql"] } },
      }).success,
    ).toBe(false);
  });

  it("accepts kind 'compose-exec' with a service", () => {
    const m = ProjectManifest.parse({
      name: "app",
      shells: { db: { kind: "compose-exec", service: "postgres", command: ["psql"] } },
    });
    expect(m.shells.db!.service).toBe("postgres");
  });

  it("accepts kind 'command' without a service", () => {
    const m = ProjectManifest.parse({
      name: "app",
      shells: { sh: { kind: "command", command: ["bash"] } },
    });
    expect(m.shells.sh!.kind).toBe("command");
  });

  it("rejects an empty command array", () => {
    expect(
      ProjectManifest.safeParse({
        name: "app",
        shells: { sh: { kind: "command", command: [] } },
      }).success,
    ).toBe(false);
  });
});

describe("PortBlock bounds", () => {
  it("defaults block to 100", () => {
    const m = ProjectManifest.parse({ name: "app", ports: { base: 3000 } });
    expect(m.ports!.block).toBe(100);
  });

  it("rejects a base below 1024", () => {
    expect(ProjectManifest.safeParse({ name: "app", ports: { base: 80 } }).success).toBe(false);
  });

  it("rejects a base above 65000", () => {
    expect(ProjectManifest.safeParse({ name: "app", ports: { base: 70000 } }).success).toBe(false);
  });

  it("accepts the boundary values", () => {
    expect(ProjectManifest.safeParse({ name: "app", ports: { base: 1024 } }).success).toBe(true);
    expect(ProjectManifest.safeParse({ name: "app", ports: { base: 65000 } }).success).toBe(true);
  });
});

describe("Script union", () => {
  it("accepts a plain string command", () => {
    const m = ProjectManifest.parse({ name: "app", commands: { build: "make" } });
    expect(m.commands.build).toBe("make");
  });

  it("accepts a { run: 'xcode' } script spec", () => {
    const m = ProjectManifest.parse({ name: "app", commands: { build: { run: "xcode" } } });
    expect(m.commands.build).toEqual({ run: "xcode" });
  });

  it("rejects an unknown run tag", () => {
    expect(
      ProjectManifest.safeParse({ name: "app", commands: { build: { run: "nope" } } }).success,
    ).toBe(false);
  });
});

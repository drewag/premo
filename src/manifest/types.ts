import { z } from "zod";

// The closed task-runner verb vocabulary. See DESIGN.md §2.
export const VERBS = ["dev", "build", "test", "lint", "deploy"] as const;
export type Verb = (typeof VERBS)[number];

// A named interactive entry point. `compose-exec` runs the command inside a
// docker compose service; `command` runs it directly.
export const ShellSpec = z
  .object({
    kind: z.enum(["compose-exec", "command"]),
    service: z.string().optional(),
    command: z.array(z.string()).min(1),
    description: z.string().optional(),
  })
  .refine((s) => s.kind !== "compose-exec" || !!s.service, {
    message: "shell.service is required when kind is 'compose-exec'",
  });
export type ShellSpec = z.infer<typeof ShellSpec>;

// Where to run an Xcode build. `platform` selects the SDK/run path; `deviceName`
// + `os` pin a specific simulator. premo resolves this (or a `--device` override
// / interactive pick) into an `xcodebuild -destination` value injected as
// PREMO_XCODE_DEST. See core/xcode.ts.
export const XcodeDestination = z.object({
  platform: z.enum(["ios-simulator", "ios-device", "macos", "visionos-simulator"]),
  deviceName: z.string().optional(), // e.g. "iPhone 17 Pro"
  os: z.string().optional(), // e.g. "26.2"
});
export type XcodeDestination = z.infer<typeof XcodeDestination>;

// Xcode project facts baked by `premo adopt` so the verbs need no live
// `xcodebuild -list` on every run. Exactly one of workspace/project is set; the
// path is relative to the unit it belongs to (the repo root, or — for an xcode
// package in a monorepo — that package's directory). Lives top-level for a
// single-app repo, or on the xcode package in a monorepo (DESIGN §13.2).
export const XcodeConfig = z.object({
  workspace: z.string().optional(), // path to .xcworkspace
  project: z.string().optional(), // path to .xcodeproj
  scheme: z.string(),
  bundleId: z.string().optional(),
  defaultDestination: XcodeDestination.optional(),
});
export type XcodeConfig = z.infer<typeof XcodeConfig>;

// A predefined, premo-owned script. The `run` tag selects a runner (see
// core/runners) that generates the real command live from the unit's declarative
// facts (e.g. the sibling `xcode` block) — so a multi-step build/run recipe lives
// in premo and stays upgradeable, instead of being baked into every premo.json.
// xcode is the first; more (compose, make, …) slot in by extending the enum.
export const ScriptSpec = z.object({ run: z.enum(["xcode"]) });
export type ScriptSpec = z.infer<typeof ScriptSpec>;

// How a verb runs: a raw shell string (the escape hatch — run via the shell) or
// a ScriptSpec premo executes through its runner. `premo adopt` writes a bare
// `xcode` block and lets the runner *imply* dev/build/test, so the recipe never
// lands in config; a literal string (or explicit spec) still overrides per verb.
export const Script = z.union([z.string(), ScriptSpec]);
export type Script = z.infer<typeof Script>;

// A package is a code sub-unit of a repo — the unit of build/test/lint (DESIGN
// §13). `dirs` are the path prefixes it owns; `affects` are other packages a
// change here also marks affected (fan-out); `affectsExcept` are path-prefix
// exceptions to that fan-out. `commands` are per-package verb overrides. `xcode`
// is present when this package is a native Apple app (baked at adopt).
export const PackageConfig = z.object({
  name: z.string(),
  dirs: z.array(z.string()).default([]),
  affects: z.array(z.string()).default([]),
  affectsExcept: z.array(z.string()).default([]),
  commands: z.record(Script).default({}),
  xcode: XcodeConfig.optional(),
});
export type PackageConfig = z.infer<typeof PackageConfig>;

// A conflict-free port block. Allocated on adopt for projects that serve, and
// optionally pinned per run/deploy target. The base is exported as $PORT.
export const PortBlock = z.object({
  base: z.number().int().min(1024).max(65000),
  block: z.number().int().min(20).max(1000).default(100),
});
export type PortBlock = z.infer<typeof PortBlock>;

// A run/deploy target (DESIGN §13.3) — a named runnable/shippable composed of
// one or more `packages`. How it comes up in `dev` is derived, in priority:
// `compose` (a docker compose file, first-class) → `command` (a leaf escape
// hatch) → the dev scripts of its member packages. `deploy` is its ship command;
// `default` marks the target bare `premo dev` brings up.
export const TargetConfig = z.object({
  name: z.string(),
  packages: z.array(z.string()).default([]),
  compose: z.string().optional(),
  command: z.string().optional(),
  deploy: z.string().optional(),
  ports: PortBlock.optional(),
  default: z.boolean().optional(),
});
export type TargetConfig = z.infer<typeof TargetConfig>;

export const DeployConfig = z.object({
  // Single env ⇒ refs are `deployed/<target>`; multiple ⇒ `deployed/<env>/<target>`.
  // The deploy command itself resolves through `commands.deploy` like other verbs.
  envs: z.array(z.string()).default(["prod"]),
});

export const ProjectManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().default("0"),

  adapter: z.string().optional(),
  // Project homepage — purely informational, so anyone who stumbles on the
  // manifest can find out what premo is and where it lives.
  homepage: z.string().optional(),
  // A conflict-free port block allocated on adopt for projects that serve; the
  // base is exported as $PORT to `dev`/`shell` and used by `open`.
  ports: PortBlock.optional(),
  // URL `premo open` launches; ${PORT} is the allocated base.
  openUrl: z.string().optional(),
  // Named interactive shells (e.g. `db` → psql).
  shells: z.record(ShellSpec).default({}),
  commands: z.record(Script).default({}),
  // The build/test/lint unit (DESIGN §13). Array of named packages; mostly
  // auto-detected and written materialized by `premo adopt`.
  packages: z.array(PackageConfig).default([]),
  // The dev/deploy unit (DESIGN §13.3). Auto-seeded 1:1 from runnable/deployable
  // packages; composite targets (e.g. a compose stack) are authored.
  targets: z.array(TargetConfig).default([]),
  changeBase: z.string().default("origin/main"),
  affectedCommand: z.string().nullable().optional(),
  deploy: DeployConfig.optional(),
  // Present when the xcode adapter has adopted this project.
  xcode: XcodeConfig.optional(),
  worktree: z.object({ carry: z.array(z.string()).default([]) }).optional(),
});
export type ProjectManifest = z.infer<typeof ProjectManifest>;
// Input shape (defaults optional) — for hand-built manifests written to disk.
export type ProjectManifestInput = z.input<typeof ProjectManifest>;

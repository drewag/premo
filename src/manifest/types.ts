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

// A package is a code sub-unit of a repo — the unit of build/test/lint (DESIGN
// §13). `dirs` are the path prefixes it owns; `affects` are other packages a
// change here also marks affected (fan-out); `affectsExcept` are path-prefix
// exceptions to that fan-out. `commands` are per-package verb overrides. (The
// run/deploy axis — `targets` — lands in a later slice; §13.3.)
export const PackageConfig = z.object({
  name: z.string(),
  dirs: z.array(z.string()).default([]),
  affects: z.array(z.string()).default([]),
  affectsExcept: z.array(z.string()).default([]),
  commands: z.record(z.string()).default({}),
});
export type PackageConfig = z.infer<typeof PackageConfig>;

export const DeployConfig = z.object({
  // Single env ⇒ refs are `deployed/<target>`; multiple ⇒ `deployed/<env>/<target>`.
  // The deploy command itself resolves through `commands.deploy` like other verbs.
  envs: z.array(z.string()).default(["prod"]),
});

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
// `xcodebuild -list` on every run. Exactly one of workspace/project is set.
export const XcodeConfig = z.object({
  workspace: z.string().optional(), // path to .xcworkspace, relative to root
  project: z.string().optional(), // path to .xcodeproj, relative to root
  scheme: z.string(),
  bundleId: z.string().optional(),
  defaultDestination: XcodeDestination.optional(),
});
export type XcodeConfig = z.infer<typeof XcodeConfig>;

export const ProjectManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().default("0"),

  adapter: z.string().optional(),
  // A conflict-free port block allocated on adopt for projects that serve; the
  // base is exported as $PORT to `dev`/`shell` and used by `open`.
  ports: z
    .object({
      base: z.number().int().min(1024).max(65000),
      block: z.number().int().min(20).max(1000).default(100),
    })
    .optional(),
  // URL `premo open` launches; ${PORT} is the allocated base.
  openUrl: z.string().optional(),
  // Named interactive shells (e.g. `db` → psql).
  shells: z.record(ShellSpec).default({}),
  commands: z.record(z.string()).default({}),
  // The build/test/lint unit (DESIGN §13). Array of named packages; mostly
  // auto-detected and written materialized by `premo adopt`.
  packages: z.array(PackageConfig).default([]),
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

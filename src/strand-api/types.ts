import { z } from "zod";

// The closed task-runner verb vocabulary. See DESIGN.md §2.
export const VERBS = ["dev", "build", "test", "lint", "deploy"] as const;
export type Verb = (typeof VERBS)[number];

export const StrandPortDecl = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "port name must be SCREAMING_SNAKE"),
  offset: z.number().int().min(0).max(99),
});

export const StrandComposeContribution = z.object({
  profiles: z.array(z.string()).default([]),
  services: z.record(z.unknown()).default({}),
  volumes: z.record(z.unknown()).default({}),
});

export const StrandWorkspace = z.object({
  path: z.string(),
});

export const StrandOpen = z.object({
  url: z.string(),
});

export const StrandShell = z
  .object({
    kind: z.enum(["compose-exec", "command"]),
    service: z.string().optional(),
    command: z.array(z.string()).min(1),
    description: z.string().optional(),
  })
  .refine((s) => s.kind !== "compose-exec" || !!s.service, {
    message: "shell.service is required when kind is 'compose-exec'",
  });

export const StrandManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().default("0"),
  description: z.string(),
  dependsOn: z.array(z.string()).default([]),
  softDependsOn: z.array(z.string()).default([]),
  ports: z.array(StrandPortDecl).default([]),
  compose: StrandComposeContribution.optional(),
  workspace: StrandWorkspace.optional(),
  skills: z.array(z.string()).default([]),
  claudeFragment: z.string().optional(),
  devCommand: z.string().optional(),
  open: StrandOpen.optional(),
  shell: StrandShell.optional(),
});
export type StrandManifest = z.infer<typeof StrandManifest>;

// A target is a sub-unit of a repo (a workspace, a package, or a strand).
// `dirs` are the path prefixes it owns; `affects` are other targets a change
// here also marks affected (fan-out); `affectsExcept` are path-prefix
// exceptions to that fan-out. `commands` are per-target verb overrides.
export const TargetConfig = z.object({
  dirs: z.array(z.string()).default([]),
  affects: z.array(z.string()).default([]),
  affectsExcept: z.array(z.string()).default([]),
  commands: z.record(z.string()).default({}),
});
export type TargetConfig = z.infer<typeof TargetConfig>;

export const DeployConfig = z.object({
  // Single env ⇒ refs are `deployed/<target>`; multiple ⇒ `deployed/<env>/<target>`.
  envs: z.array(z.string()).default(["prod"]),
  targets: z.record(z.object({ command: z.string() })).default({}),
});

export const ProjectManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().default("0"),

  // --- scaffolder fields (optional; present only in `strand new` projects) ---
  strands: z.array(z.string()).min(1).optional(),
  ports: z
    .object({
      base: z.number().int().min(1024).max(65000),
      block: z.number().int().min(20).max(1000).default(100),
    })
    .optional(),
  data: z.object({ dir: z.string() }).optional(),

  // --- task-runner fields (all optional; additive for adopted projects) ---
  adapter: z.string().optional(),
  // URL `strand open` launches for adopted projects; ${PORT} is the allocated base.
  openUrl: z.string().optional(),
  commands: z.record(z.string()).default({}),
  targets: z.record(TargetConfig).default({}),
  changeBase: z.string().default("origin/main"),
  affectedCommand: z.string().nullable().optional(),
  deploy: DeployConfig.optional(),
  worktree: z.object({ carry: z.array(z.string()).default([]) }).optional(),
});
export type ProjectManifest = z.infer<typeof ProjectManifest>;
// Input shape (defaults optional) — for hand-built manifests written to disk.
export type ProjectManifestInput = z.input<typeof ProjectManifest>;

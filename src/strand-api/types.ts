import { z } from "zod";

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

export const ProjectManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().default("0"),
  strands: z.array(z.string()).min(1),
  ports: z.object({
    base: z.number().int().min(1024).max(65000),
    block: z.number().int().min(20).max(1000).default(100),
  }),
  data: z
    .object({
      dir: z.string(),
    })
    .optional(),
});
export type ProjectManifest = z.infer<typeof ProjectManifest>;

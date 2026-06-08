import { execa } from "execa";
import type { Verb } from "../manifest/types.js";
import type { Context } from "./context.js";
import { resolvePackages, type Package } from "./packages.js";
import { changedFiles } from "./git.js";
import { affectedPackages } from "./affected.js";
import { log } from "./logger.js";

export interface VerbOptions {
  target?: string;
  all?: boolean;
  /** narrow to affected packages by default (build/test); false ⇒ whole tree (lint). */
  affected: boolean;
  /** extra env merged into each command (e.g. PREMO_XCODE_DEST). */
  env?: NodeJS.ProcessEnv;
}

interface Selection {
  packages: Package[];
  note: string;
}

async function affectedNames(ctx: Context, packages: Package[]): Promise<Set<string> | null> {
  const cmd = ctx.manifest.affectedCommand;
  if (cmd) {
    const res = await execa(cmd, { cwd: ctx.root, shell: true, reject: false });
    if (res.exitCode === 0) {
      return new Set(res.stdout.split(/\s+/).filter(Boolean));
    }
    log.warn(`affectedCommand failed (exit ${res.exitCode}); falling back to all packages.`);
    return null;
  }
  const { files, base } = await changedFiles(ctx.root, ctx.manifest.changeBase);
  if (!base) {
    log.warn("no merge base found; running all packages (use --all to silence).");
    return null;
  }
  return affectedPackages(files, packages);
}

// Returns null when an explicitly-named package doesn't exist (the caller fails).
async function select(ctx: Context, opts: VerbOptions): Promise<Selection | null> {
  const packages = await resolvePackages(ctx.root, ctx.manifest);

  if (opts.target) {
    const p = packages.find((x) => x.name === opts.target);
    if (!p) {
      log.error(
        `No package "${opts.target}". Known: ${packages.map((x) => x.name).join(", ") || "none"}`,
      );
      return null;
    }
    return { packages: [p], note: `package ${p.name}` };
  }

  if (opts.all || !opts.affected || packages.length <= 1) {
    return { packages, note: opts.all ? "all packages" : "" };
  }

  const names = await affectedNames(ctx, packages);
  if (!names) return { packages, note: "all packages" };
  const filtered = packages.filter((p) => names.has(p.name));
  return {
    packages: filtered,
    note: `affected: ${filtered.map((p) => p.name).join(", ") || "none"}`,
  };
}

// Run a verb across the selected packages, stopping on the first failure.
export async function runVerb(ctx: Context, verb: Verb, opts: VerbOptions): Promise<void> {
  const selection = await select(ctx, opts);
  if (!selection) {
    process.exitCode = 1;
    return;
  }
  const { packages, note } = selection;
  if (note) log.dim(`  ${note}`);

  const runnable = packages.filter((p) => p.commands[verb]);
  if (runnable.length === 0) {
    const where = packages.length === 0 ? "this project" : "the selected package(s)";
    log.warn(`No \`${verb}\` command resolved for ${where}.`);
    log.dim(
      '  add one under "commands" (or packages[].commands) in premo.json, run `premo adopt`,',
    );
    log.dim("  or `premo skill` to generate a task file for a coding agent to wire it up.");
    process.exitCode = 1;
    return;
  }

  for (const p of packages) {
    const cmd = p.commands[verb];
    if (!cmd) {
      log.dim(`  (no ${verb} command for ${p.name} — skipped)`);
      continue;
    }
    log.step(`${verb} ${p.name}: ${cmd}`);
    const res = await execa(cmd, {
      cwd: p.cwd,
      shell: true,
      stdio: "inherit",
      reject: false,
      env: opts.env,
    });
    if (res.exitCode !== 0) {
      log.error(`${verb} ${p.name} failed (exit ${res.exitCode}).`);
      process.exitCode = res.exitCode ?? 1;
      return;
    }
  }
  log.ok(`${verb} done`);
}

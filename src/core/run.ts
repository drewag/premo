import { execa } from "execa";
import type { Verb } from "../premo-api/types.js";
import type { Context } from "./context.js";
import { resolveTargets, type Target } from "./targets.js";
import { changedFiles } from "./git.js";
import { affectedTargets } from "./affected.js";
import { log } from "./logger.js";

export interface VerbOptions {
  target?: string;
  all?: boolean;
  /** narrow to affected targets by default (build/test); false ⇒ whole tree (lint). */
  affected: boolean;
  /** extra env merged into each command (e.g. PREMO_XCODE_DEST). */
  env?: NodeJS.ProcessEnv;
}

interface Selection {
  targets: Target[];
  note: string;
}

async function affectedNames(ctx: Context, targets: Target[]): Promise<Set<string> | null> {
  const cmd = ctx.manifest.affectedCommand;
  if (cmd) {
    const res = await execa(cmd, { cwd: ctx.root, shell: true, reject: false });
    if (res.exitCode === 0) {
      return new Set(res.stdout.split(/\s+/).filter(Boolean));
    }
    log.warn(`affectedCommand failed (exit ${res.exitCode}); falling back to all targets.`);
    return null;
  }
  const { files, base } = await changedFiles(ctx.root, ctx.manifest.changeBase);
  if (!base) {
    log.warn("no merge base found; running all targets (use --all to silence).");
    return null;
  }
  return affectedTargets(files, targets);
}

async function select(ctx: Context, opts: VerbOptions): Promise<Selection> {
  const targets = await resolveTargets(ctx.root, ctx.manifest);

  if (opts.target) {
    const t = targets.find((x) => x.name === opts.target);
    if (!t) {
      log.error(
        `No target "${opts.target}". Known: ${targets.map((x) => x.name).join(", ") || "none"}`,
      );
      process.exit(1);
    }
    return { targets: [t], note: `target ${t.name}` };
  }

  if (opts.all || !opts.affected || targets.length <= 1) {
    return { targets, note: opts.all ? "all targets" : "" };
  }

  const names = await affectedNames(ctx, targets);
  if (!names) return { targets, note: "all targets" };
  const filtered = targets.filter((t) => names.has(t.name));
  return {
    targets: filtered,
    note: `affected: ${filtered.map((t) => t.name).join(", ") || "none"}`,
  };
}

// Run a verb across the selected targets, stopping on the first failure.
export async function runVerb(ctx: Context, verb: Verb, opts: VerbOptions): Promise<void> {
  const { targets, note } = await select(ctx, opts);
  if (note) log.dim(`  ${note}`);

  const runnable = targets.filter((t) => t.commands[verb]);
  if (runnable.length === 0) {
    const where = targets.length === 0 ? "this project" : "the selected target(s)";
    log.warn(`No \`${verb}\` command resolved for ${where}.`);
    log.dim(
      '  add one under "commands" (or targets.<name>.commands) in premo.json, or run `premo adopt`.',
    );
    process.exitCode = 1;
    return;
  }

  for (const t of targets) {
    const cmd = t.commands[verb];
    if (!cmd) {
      log.dim(`  (no ${verb} command for ${t.name} — skipped)`);
      continue;
    }
    log.step(`${verb} ${t.name}: ${cmd}`);
    const res = await execa(cmd, {
      cwd: t.cwd,
      shell: true,
      stdio: "inherit",
      reject: false,
      env: opts.env,
    });
    if (res.exitCode !== 0) {
      log.error(`${verb} ${t.name} failed (exit ${res.exitCode}).`);
      process.exitCode = res.exitCode ?? 1;
      return;
    }
  }
  log.ok(`${verb} done`);
}

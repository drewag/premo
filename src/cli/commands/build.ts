import { Command } from "commander";
import { ensureContext } from "../../core/context.js";
import { runVerb } from "../../core/run.js";

export function register(program: Command): void {
  program
    .command("build")
    .description("Build the affected targets (default), one target, or --all.")
    .argument("[target]", "build a single target")
    .option("--all", "build every target, not just affected")
    .action(async (target: string | undefined, opts: { all?: boolean }) => {
      const ctx = await ensureContext(process.cwd());
      await runVerb(ctx, "build", { target, all: opts.all, affected: true });
    });
}

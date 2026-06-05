import { Command } from "commander";
import { ensureContext } from "../../core/context.js";
import { runVerb } from "../../core/run.js";

export function register(program: Command): void {
  program
    .command("test")
    .description("Test the affected targets (default), one target, or --all.")
    .argument("[target]", "test a single target")
    .option("--all", "test every target, not just affected")
    .action(async (target: string | undefined, opts: { all?: boolean }) => {
      const ctx = await ensureContext(process.cwd());
      await runVerb(ctx, "test", { target, all: opts.all, affected: true });
    });
}

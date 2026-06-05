import { Command } from "commander";
import { ensureContext } from "../../core/context.js";
import { runVerb } from "../../core/run.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("lint")
    .description("Lint (and fix) the project. --dry to only check, --all for the whole tree.")
    .argument("[target]", "lint a single target")
    .option("--all", "lint every target")
    .option("--dry", "check only, don't fix")
    .action(async (target: string | undefined, opts: { all?: boolean; dry?: boolean }) => {
      const ctx = await ensureContext(process.cwd());
      if (opts.dry) {
        log.dim("  --dry is honored only where the project's lint command checks without fixing.");
      }
      // Lint runs over the whole tree (affected: false) until per-file linting lands.
      await runVerb(ctx, "lint", { target, all: opts.all, affected: false });
    });
}

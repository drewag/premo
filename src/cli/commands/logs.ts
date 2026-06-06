import { Command } from "commander";
import { findProjectRoot } from "../../core/project.js";
import { listBackground, tailLogs } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("logs")
    .description("Tail logs of background dev processes.")
    .argument("[target]", "logs for a single target")
    .action(async (target: string | undefined) => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a premo project (no premo.json found).");
        process.exit(1);
      }
      const procs = await listBackground(root);
      if (procs.length === 0) {
        log.dim("No background processes running.");
        return;
      }
      await tailLogs(root, target);
    });
}

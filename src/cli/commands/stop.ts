import { Command } from "commander";
import { findProjectRoot } from "../../core/project.js";
import { stopBackground } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("stop")
    .description("Stop background dev processes started by `premo dev --background`.")
    .action(async () => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a premo project.");
        process.exit(1);
      }

      const stopped = await stopBackground(root);
      for (const name of stopped) log.ok(`stopped ${name}`);
      if (stopped.length === 0) {
        log.dim("Nothing running.");
        return;
      }
      log.ok("stopped");
    });
}

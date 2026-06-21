import { Command } from "commander";
import { requireProjectRoot } from "../guard.js";
import { stopBackground } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("stop")
    .description("Stop background dev processes started by `premo dev --background`.")
    .action(async () => {
      const root = requireProjectRoot();
      if (!root) return;

      const stopped = await stopBackground(root);
      if (stopped.length === 0) {
        log.dim("Nothing running.");
        return;
      }
      for (const name of stopped) log.ok(`stopped ${name}`);
    });
}

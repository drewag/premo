import { Command } from "commander";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("ports")
    .description("Show the port allocation for this project.")
    .action(async () => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a premo project.");
        process.exit(1);
      }
      const manifest = await loadProject(root);
      if (!manifest.ports) {
        log.info(`${manifest.name}  (no ports allocated)`);
        return;
      }
      log.info(`${manifest.name}  (base ${manifest.ports.base}, block ${manifest.ports.block})`);
      log.dim(`  PORT=${manifest.ports.base}`);
    });
}

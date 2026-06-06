import { Command } from "commander";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("ports")
    .description("Show the port allocation for this project.")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        if (opts.json) log.json({ error: "not-a-premo-project" });
        else log.error("Not in a premo project (no premo.json found).");
        process.exitCode = 1;
        return;
      }
      const manifest = await loadProject(root);
      if (opts.json) {
        log.json({
          name: manifest.name,
          ports: manifest.ports
            ? { base: manifest.ports.base, block: manifest.ports.block, port: manifest.ports.base }
            : null,
        });
        return;
      }
      if (!manifest.ports) {
        log.info(`${manifest.name}  (no ports allocated)`);
        return;
      }
      log.info(`${manifest.name}  (base ${manifest.ports.base}, block ${manifest.ports.block})`);
      log.dim(`  PORT=${manifest.ports.base}`);
    });
}

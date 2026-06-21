import { Command } from "commander";
import { loadProject } from "../../core/project.js";
import { requireProjectRoot } from "../guard.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("ports")
    .description("Show the port allocation for this project.")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const root = requireProjectRoot(process.cwd(), { json: opts.json });
      if (!root) return;
      const manifest = await loadProject(root);
      const targetPorts = manifest.targets
        .filter((t) => t.ports)
        .map((t) => ({ name: t.name, port: t.ports!.base }));
      if (opts.json) {
        log.json({
          name: manifest.name,
          ports: manifest.ports
            ? { base: manifest.ports.base, block: manifest.ports.block, port: manifest.ports.base }
            : null,
          targets: targetPorts,
        });
        return;
      }
      if (!manifest.ports) {
        log.info(`${manifest.name}  (no ports allocated)`);
        return;
      }
      log.info(`${manifest.name}  (base ${manifest.ports.base}, block ${manifest.ports.block})`);
      if (targetPorts.length > 0) {
        for (const t of targetPorts) log.dim(`  ${t.name}  PORT=${t.port}`);
      } else {
        log.dim(`  PORT=${manifest.ports.base}`);
      }
    });
}

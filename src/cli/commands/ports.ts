import { Command } from "commander";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { resolveStrandSet } from "../../core/strands.js";
import { allocatePorts } from "../../core/ports.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("ports")
    .description("Show the port allocation for this project.")
    .action(async () => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a strand project.");
        process.exit(1);
      }
      const manifest = await loadProject(root);
      if (!manifest.ports) {
        log.info(`${manifest.name}  (no ports allocated)`);
        return;
      }
      if (!manifest.strands?.length) {
        // Adopted project: a single allocated block, no per-strand offsets.
        log.info(`${manifest.name}  (base ${manifest.ports.base}, block ${manifest.ports.block})`);
        log.dim(`  PORT=${manifest.ports.base}`);
        return;
      }
      const resolved = await resolveStrandSet(manifest.strands);
      const ports = allocatePorts(
        manifest.ports.base,
        manifest.ports.block,
        resolved.map((s) => s.manifest),
      );
      log.info(`${manifest.name}  (base ${manifest.ports.base}, block ${manifest.ports.block})`);
      if (Object.keys(ports).length === 0) {
        log.dim("  (no ports declared by active strands)");
        return;
      }
      const width = Math.max(...Object.keys(ports).map((k) => k.length));
      for (const [k, v] of Object.entries(ports).sort((a, b) => a[1] - b[1])) {
        log.info(`  ${k.padEnd(width)}  ${v}`);
      }
    });
}

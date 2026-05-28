import { Command } from "commander";
import { listAvailableStrands, loadStrand } from "../../core/strands.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("list")
    .description("List available strands.")
    .action(async () => {
      const names = await listAvailableStrands();
      if (names.length === 0) {
        log.warn("No strands found.");
        return;
      }
      for (const name of names) {
        try {
          const s = await loadStrand(name);
          log.info(`  ${name} — ${s.manifest.description}`);
        } catch (e) {
          log.error(`  ${name} — ${(e as Error).message}`);
        }
      }
    });
}

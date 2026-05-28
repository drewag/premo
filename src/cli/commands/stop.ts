import { Command } from "commander";
import { execa } from "execa";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("stop")
    .description("Stop docker compose services for this project.")
    .action(async () => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a strand project.");
        process.exit(1);
      }
      const manifest = await loadProject(root);
      log.step(`Stopping ${manifest.name}`);
      await execa("docker", ["compose", "down"], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, COMPOSE_PROJECT_NAME: manifest.name },
      }).catch(() => undefined);
      log.ok("stopped");
    });
}

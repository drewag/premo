import { Command } from "commander";
import { execa } from "execa";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { stopBackground } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("stop")
    .description("Stop background dev processes (and docker compose for scaffolded projects).")
    .action(async () => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a strand project.");
        process.exit(1);
      }

      const stopped = await stopBackground(root);
      for (const name of stopped) log.ok(`stopped ${name}`);

      const manifest = await loadProject(root);
      if (manifest.strands?.length) {
        log.step(`Stopping ${manifest.name} services`);
        await execa("docker", ["compose", "down"], {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, COMPOSE_PROJECT_NAME: manifest.name },
        }).catch(() => undefined);
      }

      if (stopped.length === 0 && !manifest.strands?.length) {
        log.dim("Nothing running.");
        return;
      }
      log.ok("stopped");
    });
}

import { Command } from "commander";
import { findProjectRoot, PROJECT_FILE } from "../../core/project.js";
import { adoptProject } from "../../core/context.js";
import { gitRoot } from "../../core/git.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("adopt")
    .description("Detect this project's stack and write a premo.json.")
    .action(async () => {
      const cwd = process.cwd();
      if (findProjectRoot(cwd)) {
        log.warn(`${PROJECT_FILE} already exists — edit it directly, or delete it to re-adopt.`);
        return;
      }
      const root = (await gitRoot(cwd)) ?? cwd;
      await adoptProject(root);
    });
}

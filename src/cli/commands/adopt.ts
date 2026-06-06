import { Command } from "commander";
import { findProjectRoot, PROJECT_FILE } from "../../core/project.js";
import { adoptProject } from "../../core/context.js";
import { gitRoot } from "../../core/git.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("adopt")
    .description("Detect this project's stack and write a premo.json.")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const existing = findProjectRoot(cwd);
      if (existing) {
        if (opts.json) log.json({ adopted: false, reason: "already-adopted", root: existing });
        else
          log.warn(`${PROJECT_FILE} already exists — edit it directly, or delete it to re-adopt.`);
        return;
      }
      const root = (await gitRoot(cwd)) ?? cwd;
      const manifest = await adoptProject(root, { quiet: opts.json });
      if (opts.json) {
        log.json({
          adopted: true,
          root,
          file: PROJECT_FILE,
          name: manifest.name,
          adapter: manifest.adapter ?? null,
          targets: Object.keys(manifest.targets),
          commands: manifest.commands,
          ports: manifest.ports ?? null,
          xcode: manifest.xcode ?? null,
        });
      }
    });
}

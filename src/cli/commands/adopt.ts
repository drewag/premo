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
    .option("-f, --force", "re-adopt from scratch, overwriting an existing premo.json")
    .action(async (opts: { json?: boolean; force?: boolean }) => {
      const cwd = process.cwd();
      const existing = findProjectRoot(cwd);
      if (existing && !opts.force) {
        if (opts.json) log.json({ adopted: false, reason: "already-adopted", root: existing });
        else
          log.warn(
            `${PROJECT_FILE} already exists — re-adopt with --force (overwrites it), or edit it directly.`,
          );
        return;
      }
      // --force re-adopts in place at the existing project root, discarding manual
      // edits; a fresh adopt anchors at the git root (or cwd).
      const root = existing ?? (await gitRoot(cwd)) ?? cwd;
      const manifest = await adoptProject(root, { quiet: opts.json });
      if (opts.json) {
        log.json({
          adopted: true,
          root,
          file: PROJECT_FILE,
          name: manifest.name,
          adapter: manifest.adapter ?? null,
          packages: manifest.packages.map((p) => p.name),
          commands: manifest.commands,
          ports: manifest.ports ?? null,
          xcode: manifest.xcode ?? null,
        });
      }
    });
}

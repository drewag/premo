import { Command } from "commander";
import { findProjectRoot, PROJECT_FILE } from "../../core/project.js";
import { adoptProject, syncProject, type SyncResult } from "../../core/context.js";
import { gitRoot } from "../../core/git.js";
import { log } from "../../core/logger.js";

// A scannable one-liner for what an additive sync added, e.g.
// "added target web; xcode env staging; filled deploy on api".
function summarize({ changes }: SyncResult): string {
  const parts: string[] = [];
  const added = [
    ...changes.packages.map((n) => `package ${n}`),
    ...changes.targets.map((n) => `target ${n}`),
    ...changes.environments.map((n) => `env ${n}`),
    ...changes.commands.map((n) => `command ${n}`),
  ];
  if (added.length) parts.push(`added ${added.join(", ")}`);
  const filled = [...changes.fields, ...changes.packageFields, ...changes.targetFields];
  if (filled.length) parts.push(`filled ${filled.join(", ")}`);
  return parts.join("; ") || "updated";
}

export function register(program: Command): void {
  program
    .command("adopt")
    .description("Detect this project's stack and write or update premo.json.")
    .option("--json", "emit machine-readable JSON")
    .option(
      "-f, --force",
      "re-adopt from scratch, overwriting an existing premo.json (default is an additive sync)",
    )
    .action(async (opts: { json?: boolean; force?: boolean }) => {
      const cwd = process.cwd();
      const existing = findProjectRoot(cwd);

      // An already-adopted repo syncs by default: fill in newly-detected features
      // without touching anything the user configured. --force regenerates instead.
      if (existing && !opts.force) {
        const result = await syncProject(existing);
        if (opts.json) {
          log.json({
            adopted: true,
            mode: "sync",
            changed: result.changed,
            root: existing,
            file: PROJECT_FILE,
            added: {
              packages: result.changes.packages,
              targets: result.changes.targets,
              environments: result.changes.environments,
              commands: result.changes.commands,
              fields: result.changes.fields,
            },
            filled: {
              packages: result.changes.packageFields,
              targets: result.changes.targetFields,
            },
            stale: result.stale,
          });
        } else if (!result.changed) {
          log.ok(`${PROJECT_FILE} is up to date — nothing new detected.`);
        } else {
          log.ok(`updated ${PROJECT_FILE} — ${summarize(result)}`);
        }
        if (!opts.json && (result.stale.packages.length || result.stale.targets.length)) {
          const stale = [
            ...result.stale.packages.map((n) => `package ${n}`),
            ...result.stale.targets.map((n) => `target ${n}`),
          ].join(", ");
          log.dim(`  no longer detected (kept; remove by hand if gone): ${stale}`);
        }
        return;
      }

      // --force re-adopts in place at the existing project root, discarding manual
      // edits; a fresh adopt anchors at the git root (or cwd).
      const root = existing ?? (await gitRoot(cwd)) ?? cwd;
      const manifest = await adoptProject(root, { quiet: opts.json });
      if (opts.json) {
        log.json({
          adopted: true,
          mode: existing ? "force" : "fresh",
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

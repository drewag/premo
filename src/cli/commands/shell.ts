import { Command } from "commander";
import { execa } from "execa";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { resolveStrandSet, type LoadedStrand } from "../../core/strands.js";
import { allocatePorts } from "../../core/ports.js";
import { composeEnv } from "../../core/compose.js";
import { interpolateArgv } from "../../core/env.js";
import { log } from "../../core/logger.js";

export interface BuiltShell {
  argv: string[];
  cwd: string;
}

export function buildShellInvocation(
  strand: LoadedStrand,
  env: Record<string, string>,
  projectRoot: string,
  overrideCommand: string | undefined,
): BuiltShell {
  const shell = strand.manifest.shell;
  if (!shell) {
    throw new Error(`Strand "${strand.manifest.name}" does not declare a shell.`);
  }
  const raw = overrideCommand ? ["sh", "-c", overrideCommand] : shell.command;
  const command = interpolateArgv(raw, env);

  if (shell.kind === "compose-exec") {
    return {
      argv: ["docker", "compose", "exec", shell.service!, ...command],
      cwd: projectRoot,
    };
  }
  return { argv: command, cwd: projectRoot };
}

export function register(program: Command): void {
  program
    .command("shell [strand]")
    .description("Open an interactive shell against a strand (no arg: list shells).")
    .option("-c, --command <cmd>", "run a one-shot command instead of an interactive shell")
    .action(async (strandName: string | undefined, opts: { command?: string }) => {
      const { resolved, env, root } = await loadContext();
      const shellable = resolved.filter((r) => !!r.manifest.shell);

      if (!strandName) {
        if (shellable.length === 0) {
          log.warn("No active strand declares a `shell`.");
          return;
        }
        const width = Math.max(...shellable.map((r) => r.manifest.name.length));
        for (const r of shellable) {
          const desc = r.manifest.shell!.description ?? `${r.manifest.shell!.kind} shell`;
          log.info(`  ${r.manifest.name.padEnd(width)}  ${desc}`);
        }
        return;
      }

      const match = resolved.find((r) => r.manifest.name === strandName);
      if (!match) {
        log.error(
          `Strand "${strandName}" is not active in this project (active: ${resolved
            .map((r) => r.manifest.name)
            .join(", ")}).`,
        );
        process.exit(1);
      }
      if (!match.manifest.shell) {
        log.error(`Strand "${strandName}" does not declare a shell.`);
        process.exit(1);
      }

      const built = buildShellInvocation(match, env, root, opts.command);
      const result = await execa(built.argv[0]!, built.argv.slice(1), {
        cwd: built.cwd,
        env: { ...process.env, ...env },
        stdio: "inherit",
        reject: false,
      });
      if (typeof result.exitCode === "number" && result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });
}

interface ShellContext {
  resolved: LoadedStrand[];
  env: Record<string, string>;
  root: string;
}

async function loadContext(): Promise<ShellContext> {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    log.error("Not in a strand project (no strand.json found).");
    process.exit(1);
  }
  const manifest = await loadProject(root);
  const resolved = await resolveStrandSet(manifest.strands);
  const ports = allocatePorts(
    manifest.ports.base,
    manifest.ports.block,
    resolved.map((s) => s.manifest),
  );
  const dataDir = manifest.data?.dir ?? `${process.env.HOME}/.strand-data/${manifest.name}`;
  const env = composeEnv({ projectName: manifest.name, ports, dataDir });
  return { resolved, env, root };
}

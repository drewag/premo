import { Command } from "commander";
import { execa } from "execa";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { interpolateArgv } from "../../core/env.js";
import type { ShellSpec } from "../../manifest/types.js";
import { log } from "../../core/logger.js";

export interface BuiltShell {
  argv: string[];
  cwd: string;
}

export function buildShellInvocation(
  spec: ShellSpec,
  env: Record<string, string>,
  projectRoot: string,
  overrideCommand: string | undefined,
): BuiltShell {
  const raw = overrideCommand ? ["sh", "-c", overrideCommand] : spec.command;
  const command = interpolateArgv(raw, env);

  if (spec.kind === "compose-exec") {
    return { argv: ["docker", "compose", "exec", spec.service!, ...command], cwd: projectRoot };
  }
  return { argv: command, cwd: projectRoot };
}

export function register(program: Command): void {
  program
    .command("shell [name]")
    .description("Open a configured interactive shell (no arg: list shells).")
    .option("-c, --command <cmd>", "run a one-shot command instead of an interactive shell")
    .action(async (name: string | undefined, opts: { command?: string }) => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a premo project (no premo.json found).");
        process.exit(1);
      }
      const manifest = await loadProject(root);
      const shells = manifest.shells;
      const shellNames = Object.keys(shells);

      if (!name) {
        if (shellNames.length === 0) {
          log.warn("No shells configured.");
          log.dim(
            '  add one under "shells" in premo.json (or scaffold a premo that provides one).',
          );
          return;
        }
        const width = Math.max(...shellNames.map((n) => n.length));
        for (const n of shellNames) {
          const spec = shells[n]!;
          log.info(`  ${n.padEnd(width)}  ${spec.description ?? `${spec.kind} shell`}`);
        }
        return;
      }

      const spec = shells[name];
      if (!spec) {
        log.error(`No shell "${name}". Configured: ${shellNames.join(", ") || "none"}`);
        process.exit(1);
      }

      const interpEnv: Record<string, string> = { COMPOSE_PROJECT_NAME: manifest.name };
      if (manifest.ports) interpEnv.PORT = String(manifest.ports.base);

      const built = buildShellInvocation(spec, interpEnv, root, opts.command);
      const result = await execa(built.argv[0]!, built.argv.slice(1), {
        cwd: built.cwd,
        env: { ...process.env, ...interpEnv },
        stdio: "inherit",
        reject: false,
      });
      if (typeof result.exitCode === "number" && result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });
}

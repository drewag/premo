import { Command } from "commander";
import { execa, type ResultPromise } from "execa";
import path from "node:path";
import pc from "picocolors";
import { ensureContext, type Context } from "../../core/context.js";
import { resolveTargets } from "../../core/targets.js";
import { spawnDetached } from "../../core/supervise.js";
import { log } from "../../core/logger.js";
import { resolveXcodeEnv } from "../xcode-env.js";

const PREFIX_COLORS = [pc.cyan, pc.magenta, pc.yellow, pc.green, pc.blue];

export function register(program: Command): void {
  program
    .command("dev")
    .description("Run the project locally; --background to detach.")
    .argument("[target]", "run a single target")
    .option("--background", "run detached; manage with `premo logs` / `premo stop`")
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .option("-v, --verbose", "show full build logs (xcode projects); hidden by default")
    .action(
      async (
        target: string | undefined,
        opts: { background?: boolean; device?: string; platform?: string; verbose?: boolean },
      ) => {
        const ctx = await ensureContext(process.cwd());
        // Prompt for a destination interactively, unless detaching; remember it
        // as this project's last-run device for next time.
        const xcodeEnv = await resolveXcodeEnv(ctx, opts, !opts.background, true);
        if (xcodeEnv === null) {
          process.exitCode = 1;
          return;
        }
        await runAdoptedDev(ctx, target, !!opts.background, xcodeEnv);
      },
    );
}

async function runAdoptedDev(
  ctx: Context,
  targetArg: string | undefined,
  background: boolean,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  const targets = await resolveTargets(ctx.root, ctx.manifest);
  let devTargets = targets.filter((t) => t.commands.dev);

  if (targetArg) {
    const t = targets.find((x) => x.name === targetArg);
    if (!t) {
      log.error(
        `No target "${targetArg}". Known: ${targets.map((x) => x.name).join(", ") || "none"}`,
      );
      process.exit(1);
    }
    if (!t.commands.dev) {
      log.error(`Target "${targetArg}" has no dev command.`);
      process.exit(1);
    }
    devTargets = [t];
  }

  if (devTargets.length === 0) {
    log.warn("No `dev` command resolved for this project.");
    log.dim('  add one under "commands" in premo.json, or run `premo adopt`.');
    process.exitCode = 1;
    return;
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (ctx.manifest.ports) env.PORT = String(ctx.manifest.ports.base);

  if (background) {
    for (const t of devTargets) {
      const proc = await spawnDetached(ctx.root, t.name, t.commands.dev!, t.cwd, env);
      log.ok(`${t.name} → pid ${proc.pid}, logs: ${path.relative(ctx.root, proc.logPath)}`);
    }
    log.dim("  `premo logs` to tail, `premo stop` to stop.");
    return;
  }

  const children: ResultPromise[] = [];
  let colorIdx = 0;
  for (const t of devTargets) {
    const color = PREFIX_COLORS[colorIdx++ % PREFIX_COLORS.length]!;
    // Multi-line commands (e.g. the xcode build/run script) would flood the
    // line; show just the target name in that case.
    log.step(
      t.commands.dev!.includes("\n")
        ? `Starting ${t.name}`
        : `Starting ${t.name} (${t.commands.dev})`,
    );
    const proc = execa(t.commands.dev!, {
      cwd: t.cwd,
      env,
      shell: true,
      stdout: "pipe",
      stderr: "pipe",
      reject: false,
    });
    const prefix = color(`[${t.name}]`);
    proc.stdout?.on("data", (b: Buffer) => prefixWrite(prefix, b, process.stdout));
    proc.stderr?.on("data", (b: Buffer) => prefixWrite(prefix, b, process.stderr));
    children.push(proc);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of children) if (!c.killed) c.kill("SIGTERM");
    await Promise.allSettled(children);
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  log.ok("dev up — Ctrl-C to stop");
  if (ctx.manifest.ports) log.dim(`  PORT=${ctx.manifest.ports.base}`);

  await Promise.race(children);
  await shutdown();
}

function prefixWrite(prefix: string, buf: Buffer, out: NodeJS.WriteStream): void {
  const text = buf.toString("utf8").trimEnd();
  if (!text) return;
  for (const line of text.split("\n")) out.write(`${prefix} ${line}\n`);
}

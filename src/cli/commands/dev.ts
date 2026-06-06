import { Command } from "commander";
import { execa, type ResultPromise } from "execa";
import path from "node:path";
import pc from "picocolors";
import { ensureContext, type Context } from "../../core/context.js";
import { resolveTargets, type Target } from "../../core/targets.js";
import { spawnDetached } from "../../core/supervise.js";
import { shq } from "../../core/shell.js";
import { log } from "../../core/logger.js";
import { resolveXcodeEnv } from "../xcode-env.js";

const PREFIX_COLORS = [pc.cyan, pc.magenta, pc.yellow, pc.green, pc.blue];

// Split a `dev` invocation's passthrough args from its [target]. Commander erases
// the `--` boundary and binds [target] to the first operand even when that operand
// lives *after* `--` — so when `--` is present we take everything after it as
// passthrough and discard a [target] that's really the first passthrough token.
export function splitPassthrough(
  argv: string[],
  commanderTarget: string | undefined,
): { target: string | undefined; passthrough: string[] } {
  const idx = argv.indexOf("--");
  if (idx === -1) return { target: commanderTarget, passthrough: [] };
  const passthrough = argv.slice(idx + 1);
  const target =
    commanderTarget && commanderTarget !== passthrough[0] ? commanderTarget : undefined;
  return { target, passthrough };
}

export function register(program: Command): void {
  program
    .command("dev")
    .description(
      "Run the project locally; --background to detach. For CLI projects: `dev -- <args>`.",
    )
    .argument("[target]", "run a single target")
    .option("--background", "run detached; manage with `premo logs` / `premo stop`")
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .option("-v, --verbose", "show full build logs (xcode projects); hidden by default")
    .action(
      async (
        targetArg: string | undefined,
        opts: { background?: boolean; device?: string; platform?: string; verbose?: boolean },
      ) => {
        const { target, passthrough } = splitPassthrough(process.argv, targetArg);
        const ctx = await ensureContext(process.cwd());
        // Prompt for a destination interactively, unless detaching; remember it
        // as this project's last-run device for next time.
        const xcodeEnv = await resolveXcodeEnv(ctx, opts, !opts.background, true);
        if (xcodeEnv === null) {
          process.exitCode = 1;
          return;
        }
        await runAdoptedDev(ctx, target, !!opts.background, xcodeEnv, passthrough);
      },
    );
}

async function runAdoptedDev(
  ctx: Context,
  targetArg: string | undefined,
  background: boolean,
  extraEnv: NodeJS.ProcessEnv = {},
  passthrough: string[] = [],
): Promise<void> {
  const targets = await resolveTargets(ctx.root, ctx.manifest);
  let devTargets = targets.filter((t) => t.commands.dev);

  if (targetArg) {
    const t = targets.find((x) => x.name === targetArg);
    if (!t) {
      log.error(
        `No target "${targetArg}". Known: ${targets.map((x) => x.name).join(", ") || "none"}`,
      );
      process.exitCode = 1;
      return;
    }
    if (!t.commands.dev) {
      log.error(`Target "${targetArg}" has no dev command.`);
      process.exitCode = 1;
      return;
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

  // A command-style target (a CLI, not a server) runs as one foreground process
  // over the real TTY, with `-- <args>` passed through. No multiplex/piping.
  if (devTargets.length === 1 && devTargets[0]!.kind === "command") {
    if (background) {
      log.error("`--background` isn't supported for a CLI project (it runs in the foreground).");
      process.exitCode = 1;
      return;
    }
    await runCommandDev(devTargets[0]!, env, passthrough);
    return;
  }

  if (passthrough.length > 0) {
    log.warn("`-- <args>` passthrough only applies to CLI projects; ignoring.");
  }

  if (background) {
    if (process.platform === "win32") {
      log.error(
        "`--background` isn't supported on Windows (supervision uses POSIX process groups).",
      );
      process.exitCode = 1;
      return;
    }
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

// Run a CLI target in the foreground over the inherited TTY (so its own prompts,
// colors, and Ctrl-C work), appending shell-quoted passthrough args. The exit
// code is propagated so `premo dev -- <args>` is scriptable.
async function runCommandDev(
  t: Target,
  env: NodeJS.ProcessEnv,
  passthrough: string[],
): Promise<void> {
  const extra = passthrough.length ? " " + passthrough.map(shq).join(" ") : "";
  const cmd = t.commands.dev! + extra;
  // Diagnostic to stderr so stdout stays exactly the tool's own output (an agent
  // can pipe `premo dev -- doctor --json` straight into a JSON parser).
  process.stderr.write(pc.cyan(`→ Running ${t.name}: ${cmd}\n`));
  const res = await execa(cmd, { cwd: t.cwd, env, shell: true, stdio: "inherit", reject: false });
  process.exitCode = res.exitCode ?? 0;
}

function prefixWrite(prefix: string, buf: Buffer, out: NodeJS.WriteStream): void {
  const text = buf.toString("utf8").trimEnd();
  if (!text) return;
  for (const line of text.split("\n")) out.write(`${prefix} ${line}\n`);
}

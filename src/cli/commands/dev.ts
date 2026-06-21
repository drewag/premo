import { Command } from "commander";
import { execa, type ResultPromise } from "execa";
import path from "node:path";
import readline from "node:readline";
import pc from "picocolors";
import { ensureContext, type Context } from "../../core/context.js";
import { resolveTargets, defaultTarget, type DevProc } from "../../core/targets.js";
import { configEnv, envFileVars } from "../../core/env.js";
import { spawnDetached } from "../../core/supervise.js";
import { shq } from "../../core/shell.js";
import { installFooter, type Footer } from "../../core/footer.js";
import { isDeviceLockedError } from "../../core/xcode.js";
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
    .option("-e, --env <name>", "environment to run (e.g. dev | prod); see premo.json")
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .option("--pick", "re-prompt for the destination, ignoring the last used (xcode projects)")
    .option("-v, --verbose", "show full build logs (xcode projects); hidden by default")
    .action(
      async (
        targetArg: string | undefined,
        opts: {
          background?: boolean;
          env?: string;
          device?: string;
          platform?: string;
          pick?: boolean;
          verbose?: boolean;
        },
      ) => {
        const { target, passthrough } = splitPassthrough(process.argv, targetArg);
        const ctx = await ensureContext(process.cwd());
        // Prompt for a destination interactively, unless detaching; remember it
        // as this project's last-run device for next time.
        const xcodeEnv = await resolveXcodeEnv(ctx, opts, !opts.background, true, target);
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

  let target;
  if (targetArg) {
    target = targets.find((t) => t.name === targetArg) ?? null;
    if (!target) {
      log.error(
        `No target "${targetArg}". Known: ${targets.map((t) => t.name).join(", ") || "none"}`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    target = defaultTarget(targets);
    if (!target) {
      if (targets.length === 0) {
        log.warn("No `dev` target resolved for this project.");
        log.dim("  add a package with a dev script, a target in premo.json, or run `premo adopt`.");
      } else {
        log.error(`Multiple targets — pick one: ${targets.map((t) => t.name).join(", ")}`);
        log.dim('  or mark one "default": true in premo.json.');
      }
      process.exitCode = 1;
      return;
    }
  }

  const runnables = target.dev;
  if (runnables.length === 0) {
    log.error(`Target "${target.name}" has no dev command.`);
    process.exitCode = 1;
    return;
  }

  const fileVars = await envFileVars(
    ctx.root,
    ctx.manifest.envFile ?? undefined,
    extraEnv?.PREMO_ENV,
  );
  const portBase = target.ports?.base ?? ctx.manifest.ports?.base;

  // Each process binds its OWN port (a composite target runs several dev servers
  // at once), falling back to the target/project base for a single server. Env is
  // resolved PER-PROC so each member of a composite target gets its own
  // PackageConfig.env layered over the project `env` + envFile (configEnv).
  const portFor = (r: DevProc): number | undefined => r.port ?? portBase;
  const envFor = (r: DevProc): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...configEnv(fileVars, ctx.manifest.env, r.env),
      ...extraEnv,
    };
    const p = portFor(r);
    return p !== undefined ? { ...env, PORT: String(p) } : env;
  };

  // A single command-style runnable (a CLI, not a server) runs in the foreground
  // over the real TTY, with `-- <args>` passed through. No multiplex/piping.
  if (runnables.length === 1 && runnables[0]!.kind === "command") {
    if (background) {
      log.error("`--background` isn't supported for a CLI project (it runs in the foreground).");
      process.exitCode = 1;
      return;
    }
    await runCommandDev(runnables[0]!, envFor(runnables[0]!), passthrough);
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
    try {
      for (const r of runnables) {
        const proc = await spawnDetached(ctx.root, r.label, r.command, r.cwd, envFor(r));
        log.ok(`${r.label} → pid ${proc.pid}, logs: ${path.relative(ctx.root, proc.logPath)}`);
      }
    } catch (err) {
      log.error(`Couldn't start the background process: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    log.dim("  `premo logs` to tail, `premo stop` to stop.");
    return;
  }

  // A run targeting a physical iOS device installs/launches via devicectl, which
  // fails if the device is locked. We watch the output for that so we can prompt
  // for an unlock + retry rather than dying with a raw devicectl error. The
  // destination is the same for every proc, so the resolved xcode env decides it.
  const xcodeDevice = !!extraEnv.PREMO_XCODE_DEVICE_UDID;
  let lockDetected = false;

  let children: ResultPromise[] = [];
  const spawnAll = () => {
    children = [];
    lockDetected = false;
    let colorIdx = 0;
    for (const r of runnables) {
      const color = PREFIX_COLORS[colorIdx++ % PREFIX_COLORS.length]!;
      // Multi-line commands (e.g. the xcode build/run script) would flood the
      // line; show just the process label in that case.
      const portTag = portFor(r) !== undefined ? pc.dim(` :${portFor(r)}`) : "";
      log.step(
        (r.command.includes("\n") ? `Starting ${r.label}` : `Starting ${r.label} (${r.command})`) +
          portTag,
      );
      const proc = execa(r.command, {
        cwd: r.cwd,
        env: envFor(r),
        shell: true,
        stdout: "pipe",
        stderr: "pipe",
        reject: false,
      });
      const prefix = color(`[${r.label}]`);
      const onChunk = (b: Buffer) => {
        if (xcodeDevice && !lockDetected && isDeviceLockedError(b.toString("utf8"))) {
          lockDetected = true;
        }
        prefixWrite(prefix, b, process.stdout);
      };
      proc.stdout?.on("data", onChunk);
      proc.stderr?.on("data", onChunk);
      children.push(proc);
    }
  };

  const killChildren = async () => {
    for (const c of children) if (!c.killed) c.kill("SIGTERM");
    await Promise.allSettled(children);
  };

  // A re-armable control signal. A keypress (or an OS signal) resolves the
  // current wait with an action, so an intentional restart's child exits aren't
  // mistaken for a crash.
  let fireControl!: (action: "restart" | "quit") => void;
  const armControl = () =>
    new Promise<"restart" | "quit">((resolve) => {
      fireControl = resolve;
    });
  let control = armControl();

  // Single-key controls only when we own a real TTY; under a pipe/CI there are
  // no keypresses and SIGINT/SIGTERM remain the way out.
  const interactive = !!process.stdin.isTTY;
  const wasRaw = process.stdin.isRaw ?? false;
  const onKey = (_str: string, key: readline.Key | undefined) => {
    if (!key) return;
    if (key.name === "r") fireControl("restart");
    else if (key.name === "q" || (key.ctrl && key.name === "c")) fireControl("quit");
  };
  const restoreTty = () => {
    if (!interactive) return;
    process.stdin.off("keypress", onKey);
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  };

  let footer: Footer | null = null;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    footer?.clear();
    restoreTty();
    await killChildren();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  spawnAll();

  if (interactive) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
  }

  // Per-process ports (a composite target runs several); fall back to the single
  // target/project base when no proc carries its own.
  const ports = [...new Set(runnables.map(portFor).filter((p): p is number => p !== undefined))];
  log.ok(interactive ? "dev up — press r to restart, q to quit" : "dev up — Ctrl-C to stop");
  if (ports.length > 0) log.dim(`  ports: ${ports.join(", ")}`);

  if (interactive) {
    const portStr = ports.length > 0 ? ` · :${ports.join(" :")}` : "";
    footer = installFooter(` premo dev · r restart · q quit${portStr} `);
  }

  type Event = { kind: "restart" | "quit" } | { kind: "exit"; code: number | null };
  let awaitingUnlock = false;
  for (;;) {
    const waits: Promise<Event>[] = [control.then((kind) => ({ kind }))];
    // While we're waiting for the user to unlock, the children are already dead;
    // race only the control signal so a fresh keypress drives the retry.
    if (!awaitingUnlock) {
      waits.push(
        Promise.race(
          children.map((c) => c.then((r) => ({ kind: "exit" as const, code: r.exitCode ?? null }))),
        ),
      );
    }
    const ev = await Promise.race(waits);

    if (ev.kind === "restart") {
      log.step(awaitingUnlock ? "Retrying…" : "Restarting…");
      awaitingUnlock = false;
      await killChildren();
      control = armControl();
      spawnAll();
      continue;
    }
    if (ev.kind !== "exit") break; // "quit"

    // A target ended on its own. If a device run failed because the device is
    // locked, don't tear down: prompt for an unlock and reuse `r` to retry
    // (a no-op incremental rebuild, then re-install/launch).
    if (xcodeDevice && lockDetected && ev.code !== 0) {
      if (interactive) {
        awaitingUnlock = true;
        log.warn("Device is locked. Unlock it, then press r to retry (q to quit).");
        continue;
      }
      log.error("Device is locked — unlock it and run `premo dev` again.");
      process.exitCode = 1;
    }
    break;
  }
  await shutdown();
}

// Run a CLI target in the foreground over the inherited TTY (so its own prompts,
// colors, and Ctrl-C work), appending shell-quoted passthrough args. The exit
// code is propagated so `premo dev -- <args>` is scriptable.
async function runCommandDev(
  r: DevProc,
  env: NodeJS.ProcessEnv,
  passthrough: string[],
): Promise<void> {
  const extra = passthrough.length ? " " + passthrough.map(shq).join(" ") : "";
  const cmd = r.command + extra;
  // Diagnostic to stderr so stdout stays exactly the tool's own output (an agent
  // can pipe `premo dev -- doctor --json` straight into a JSON parser).
  process.stderr.write(pc.cyan(`→ Running ${r.label}: ${cmd}\n`));
  const res = await execa(cmd, { cwd: r.cwd, env, shell: true, stdio: "inherit", reject: false });
  process.exitCode = res.exitCode ?? 0;
}

function prefixWrite(prefix: string, buf: Buffer, out: NodeJS.WriteStream): void {
  const text = buf.toString("utf8").trimEnd();
  if (!text) return;
  for (const line of text.split("\n")) out.write(`${prefix} ${line}\n`);
}

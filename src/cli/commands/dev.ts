import { Command } from "commander";
import { execa, type ResultPromise } from "execa";
import { existsSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { ensureContext, type Context } from "../../core/context.js";
import { resolveStrandSet } from "../../core/strands.js";
import { allocatePorts } from "../../core/ports.js";
import { composeEnv, generateCompose } from "../../core/compose.js";
import { writePortsManifest } from "../../core/runtime.js";
import { resolveTargets } from "../../core/targets.js";
import { spawnDetached } from "../../core/supervise.js";
import { log } from "../../core/logger.js";
import { resolveXcodeEnv } from "../xcode-env.js";
import { writeFile } from "node:fs/promises";

const PREFIX_COLORS = [pc.cyan, pc.magenta, pc.yellow, pc.green, pc.blue];

export function register(program: Command): void {
  program
    .command("dev")
    .description("Run the project locally; --background to detach.")
    .argument("[target]", "run a single target")
    .option("--background", "run detached; manage with `strand logs` / `strand stop`")
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .option("-v, --verbose", "show full build logs (xcode projects); hidden by default")
    .action(
      async (
        target: string | undefined,
        opts: { background?: boolean; device?: string; platform?: string; verbose?: boolean },
      ) => {
        const ctx = await ensureContext(process.cwd());
        if (ctx.manifest.strands?.length) {
          await runScaffoldedDev(ctx);
          return;
        }
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

// --- scaffolded projects: compose services + multi-strand host processes ---

async function runScaffoldedDev(ctx: Context): Promise<void> {
  const { root, manifest } = ctx;
  if (!manifest.ports) {
    log.error("Scaffolded project is missing a `ports` block in strand.json.");
    process.exit(1);
  }
  const resolved = await resolveStrandSet(manifest.strands!);
  const ports = allocatePorts(
    manifest.ports.base,
    manifest.ports.block,
    resolved.map((s) => s.manifest),
  );
  const dataDir = manifest.data?.dir ?? `${process.env.HOME}/.strand-data/${manifest.name}`;

  log.step("Refreshing docker-compose.yml");
  const composeYaml = generateCompose({
    projectName: manifest.name,
    strands: resolved.map((s) => s.manifest),
    ports,
    dataDir,
  });
  await writeFile(path.join(root, "docker-compose.yml"), composeYaml, "utf8");
  await writePortsManifest(root, ports);

  const env = { ...process.env, ...composeEnv({ projectName: manifest.name, ports, dataDir }) };

  const hasServices = resolved.some(
    (s) => s.manifest.compose && Object.keys(s.manifest.compose.services).length > 0,
  );
  if (hasServices) {
    log.step("Starting docker compose services");
    await execa("docker", ["compose", "up", "-d"], { cwd: root, env, stdio: "inherit" });
  }

  const children: ResultPromise[] = [];
  let colorIdx = 0;
  for (const s of resolved) {
    if (!s.manifest.devCommand || !s.manifest.workspace) continue;
    const wsPath = path.join(root, s.manifest.workspace.path);
    if (!existsSync(wsPath)) continue;
    const color = PREFIX_COLORS[colorIdx++ % PREFIX_COLORS.length]!;
    log.step(`Starting ${s.manifest.name} (${s.manifest.devCommand})`);
    const proc = execa(s.manifest.devCommand, {
      cwd: wsPath,
      env,
      shell: true,
      stdout: "pipe",
      stderr: "pipe",
      reject: false,
    });
    const prefix = color(`[${s.manifest.name}]`);
    proc.stdout?.on("data", (b: Buffer) => prefixWrite(prefix, b, process.stdout));
    proc.stderr?.on("data", (b: Buffer) => prefixWrite(prefix, b, process.stderr));
    children.push(proc);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("");
    log.step("Shutting down");
    for (const c of children) if (!c.killed) c.kill("SIGTERM");
    await Promise.allSettled(children);
    if (hasServices) {
      await execa("docker", ["compose", "stop"], { cwd: root, env, stdio: "inherit" }).catch(
        () => undefined,
      );
    }
    log.ok("stopped");
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  log.ok("dev up — Ctrl-C to stop");
  const portList = Object.entries(ports)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");
  log.dim(`  ports: ${portList}`);

  await Promise.race(children);
  await shutdown();
}

// --- adopted projects: run resolved dev command(s) ---

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
    log.dim('  add one under "commands" in strand.json, or run `strand adopt`.');
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
    log.dim("  `strand logs` to tail, `strand stop` to stop.");
    return;
  }

  const children: ResultPromise[] = [];
  let colorIdx = 0;
  for (const t of devTargets) {
    const color = PREFIX_COLORS[colorIdx++ % PREFIX_COLORS.length]!;
    log.step(`Starting ${t.name} (${t.commands.dev})`);
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

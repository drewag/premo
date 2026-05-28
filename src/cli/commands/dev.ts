import { Command } from "commander";
import { execa, type ResultPromise } from "execa";
import { existsSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { resolveStrandSet } from "../../core/strands.js";
import { allocatePorts } from "../../core/ports.js";
import { composeEnv, generateCompose } from "../../core/compose.js";
import { writePortsManifest } from "../../core/runtime.js";
import { log } from "../../core/logger.js";
import { writeFile } from "node:fs/promises";

const PREFIX_COLORS = [pc.cyan, pc.magenta, pc.yellow, pc.green, pc.blue];

export function register(program: Command): void {
  program
    .command("dev")
    .description("Run the project locally in dev mode (foreground).")
    .action(async () => {
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

      const children: { name: string; proc: ResultPromise; color: (s: string) => string }[] = [];
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
        children.push({ name: s.manifest.name, proc, color });
      }

      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        log.info("");
        log.step("Shutting down");
        for (const c of children) {
          if (!c.proc.killed) c.proc.kill("SIGTERM");
        }
        await Promise.allSettled(children.map((c) => c.proc));
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

      await Promise.race(children.map((c) => c.proc));
      await shutdown();
    });
}

function prefixWrite(prefix: string, buf: Buffer, out: NodeJS.WriteStream): void {
  const text = buf.toString("utf8").trimEnd();
  if (!text) return;
  for (const line of text.split("\n")) out.write(`${prefix} ${line}\n`);
}

import { Command } from "commander";
import { execa } from "execa";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { resolveStrandSet } from "../../core/strands.js";
import { allocatePorts } from "../../core/ports.js";
import { composeEnv } from "../../core/compose.js";
import { interpolateEnv } from "../../core/env.js";
import type { ProjectManifest } from "../../strand-api/types.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("open [strand]")
    .description("Open the project (or a strand's) URL in the browser.")
    .action(async (strandName: string | undefined) => {
      const root = findProjectRoot(process.cwd());
      if (!root) {
        log.error("Not in a strand project (no strand.json found).");
        process.exit(1);
      }
      const manifest = await loadProject(root);
      if (manifest.strands?.length && manifest.ports) {
        await openScaffolded(manifest, strandName);
      } else {
        await openAdopted(manifest);
      }
    });
}

async function openAdopted(manifest: ProjectManifest): Promise<void> {
  if (!manifest.ports) {
    log.warn("No port is allocated for this project, so there's no URL to open.");
    log.dim("  run `strand dev` once to allocate one, or set `openUrl` in strand.json.");
    return;
  }
  const template = manifest.openUrl ?? "http://localhost:${PORT}";
  const url = interpolateEnv(template, { PORT: manifest.ports.base });
  await launch(url);
}

async function openScaffolded(
  manifest: ProjectManifest,
  strandName: string | undefined,
): Promise<void> {
  const resolved = await resolveStrandSet(manifest.strands!);
  const ports = allocatePorts(
    manifest.ports!.base,
    manifest.ports!.block,
    resolved.map((s) => s.manifest),
  );
  const dataDir = manifest.data?.dir ?? `${process.env.HOME}/.strand-data/${manifest.name}`;
  const env = composeEnv({ projectName: manifest.name, ports, dataDir });
  const openable = resolved.filter((r) => !!r.manifest.open);

  if (!strandName) {
    if (openable.length === 0) {
      log.warn("No active strand declares an `open` URL.");
      return;
    }
    const width = Math.max(...openable.map((r) => r.manifest.name.length));
    for (const r of openable) {
      log.info(`  ${r.manifest.name.padEnd(width)}  ${interpolateEnv(r.manifest.open!.url, env)}`);
    }
    return;
  }

  const match = resolved.find((r) => r.manifest.name === strandName);
  if (!match) {
    log.error(
      `Strand "${strandName}" is not active (active: ${resolved.map((r) => r.manifest.name).join(", ")}).`,
    );
    process.exit(1);
  }
  if (!match.manifest.open) {
    log.error(`Strand "${strandName}" does not declare an \`open\` URL.`);
    process.exit(1);
  }
  await launch(interpolateEnv(match.manifest.open.url, env));
}

async function launch(url: string): Promise<void> {
  log.step(`Opening ${url}`);
  const opener = platformOpener();
  if (!opener) {
    log.error(`No known opener for platform ${process.platform}.`);
    process.exit(1);
  }
  await execa(opener[0]!, [...opener.slice(1), url], { detached: true, stdio: "ignore" }).catch(
    (e: Error) => {
      log.error(`Failed to launch opener: ${e.message}`);
      process.exit(1);
    },
  );
}

function platformOpener(): string[] | null {
  switch (process.platform) {
    case "darwin":
      return ["open"];
    case "win32":
      return ["cmd", "/c", "start", ""];
    case "linux":
      return ["xdg-open"];
    default:
      return null;
  }
}

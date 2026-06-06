import { Command } from "commander";
import { execa } from "execa";
import { loadProject } from "../../core/project.js";
import { requireProjectRoot } from "../guard.js";
import { interpolateEnv } from "../../core/env.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("open")
    .description("Open the project's URL in the browser.")
    .action(async () => {
      const root = requireProjectRoot();
      if (!root) return;
      const manifest = await loadProject(root);
      if (!manifest.ports && !manifest.openUrl) {
        log.warn("No port is allocated for this project, so there's no URL to open.");
        log.dim("  run `premo dev` once to allocate one, or set `openUrl` in premo.json.");
        return;
      }
      const template = manifest.openUrl ?? "http://localhost:${PORT}";
      const url = interpolateEnv(template, { PORT: manifest.ports?.base ?? 0 });
      await launch(url);
    });
}

async function launch(url: string): Promise<void> {
  log.step(`Opening ${url}`);
  const opener = platformOpener();
  if (!opener) {
    log.error(`No known opener for platform ${process.platform}.`);
    process.exitCode = 1;
    return;
  }
  await execa(opener[0]!, [...opener.slice(1), url], { detached: true, stdio: "ignore" }).catch(
    (e: Error) => {
      log.error(`Failed to launch opener: ${e.message}`);
      process.exitCode = 1;
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

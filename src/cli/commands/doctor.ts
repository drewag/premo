import { Command } from "commander";
import { execa } from "execa";
import { log } from "../../core/logger.js";

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

const MIN_NODE_MAJOR = 22;

const checks: Check[] = [
  {
    name: "node >= 22",
    run: async () => {
      const major = parseInt(process.versions.node.split(".")[0]!, 10);
      return {
        ok: major >= MIN_NODE_MAJOR,
        detail: `v${process.versions.node}`,
      };
    },
  },
  {
    name: "docker",
    run: async () => {
      try {
        const { stdout } = await execa("docker", ["--version"]);
        await execa("docker", ["info"], { stdio: "ignore" });
        return { ok: true, detail: stdout.trim() };
      } catch {
        return { ok: false, detail: "not running or not installed" };
      }
    },
  },
  {
    name: "git",
    run: async () => {
      try {
        const { stdout } = await execa("git", ["--version"]);
        return { ok: true, detail: stdout.trim() };
      } catch {
        return { ok: false, detail: "not installed" };
      }
    },
  },
  {
    name: "yarn classic (1.x)",
    run: async () => {
      try {
        const { stdout } = await execa("yarn", ["--version"]);
        const major = parseInt(stdout.trim().split(".")[0]!, 10);
        return {
          ok: major === 1,
          detail: `v${stdout.trim()}${major !== 1 ? " (need classic 1.x)" : ""}`,
        };
      } catch {
        return { ok: false, detail: "not installed" };
      }
    },
  },
];

export function register(program: Command): void {
  program
    .command("doctor")
    .description("Check that this host can run strand projects.")
    .action(async () => {
      let allOk = true;
      for (const check of checks) {
        const { ok, detail } = await check.run();
        if (ok) log.ok(`${check.name} — ${detail}`);
        else {
          log.error(`${check.name} — ${detail}`);
          allOk = false;
        }
      }
      if (!allOk) process.exit(1);
    });
}

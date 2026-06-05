import { Command } from "commander";
import { execa } from "execa";
import pc from "picocolors";
import { VERBS, type Verb } from "../../strand-api/types.js";
import { inspectContext } from "../../core/context.js";
import { resolveTargets, type Target } from "../../core/targets.js";
import { isGitRepo, resolveBase } from "../../core/git.js";
import { listBackground } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

const MIN_NODE_MAJOR = 22;

const hostChecks: Check[] = [
  {
    name: "node >= 22",
    run: async () => {
      const major = parseInt(process.versions.node.split(".")[0]!, 10);
      return { ok: major >= MIN_NODE_MAJOR, detail: `v${process.versions.node}` };
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
    name: "docker",
    run: async () => {
      try {
        const { stdout } = await execa("docker", ["--version"]);
        await execa("docker", ["info"], { stdio: "ignore" });
        return { ok: true, detail: stdout.trim() };
      } catch {
        return { ok: false, detail: "not running (only needed for scaffolded projects)" };
      }
    },
  },
  {
    name: "yarn classic (1.x)",
    run: async () => {
      try {
        const { stdout } = await execa("yarn", ["--version"]);
        const major = parseInt(stdout.trim().split(".")[0]!, 10);
        return { ok: major === 1, detail: `v${stdout.trim()}` };
      } catch {
        return { ok: false, detail: "not installed" };
      }
    },
  },
];

export function register(program: Command): void {
  program
    .command("doctor")
    .description("Show host prerequisites and which verbs are wired in this project.")
    .action(async () => {
      log.info(pc.bold("Host"));
      for (const check of hostChecks) {
        const { ok, detail } = await check.run();
        if (ok) log.ok(`${check.name} — ${detail}`);
        else log.warn(`${check.name} — ${detail}`);
      }
      log.info("");
      await projectSection();
    });
}

async function projectSection(): Promise<void> {
  const cwd = process.cwd();
  const { root, manifest, adopted, adapterName } = await inspectContext(cwd);

  log.info(pc.bold("Project"));
  log.info(`  ${manifest.name}  ${pc.dim(root)}`);
  log.info(
    `  strand.json   ${adopted ? pc.green("present") : pc.yellow("not yet — auto-adopts on first verb")}`,
  );
  log.info(`  adapter       ${adapterName ?? pc.yellow("none (add commands manually)")}`);

  // git / affected readiness
  if (await isGitRepo(root)) {
    const base = await resolveBase(root, manifest.changeBase);
    log.info(
      base
        ? `  git           repo; affected detection ready ${pc.dim(`(base ${base})`)}`
        : `  git           repo; ${pc.yellow("no base ref — build/test will run all targets")}`,
    );
  } else {
    log.info(`  git           ${pc.yellow("not a git repo — build/test will run all targets")}`);
  }

  // ports
  log.info(
    manifest.ports
      ? `  ports         ${manifest.ports.base}–${manifest.ports.base + (manifest.ports.block ?? 100) - 1}`
      : `  ports         ${pc.dim("none allocated")}`,
  );

  // background processes
  const bg = await listBackground(root);
  if (bg.length > 0) {
    log.info(`  background    ${bg.map((p) => `${p.name}(pid ${p.pid})`).join(", ")}`);
  }

  // verb × target matrix
  const targets = await resolveTargets(root, manifest);
  log.info("");
  log.info(pc.bold("  Verb wiring"));
  printMatrix(targets);

  // gaps
  log.info("");
  printGaps(targets);
}

function cell(present: boolean, width: number): string {
  const sym = present ? pc.green("✓") : pc.dim("·");
  return sym + " ".repeat(Math.max(0, width - 1));
}

function printMatrix(targets: Target[]): void {
  const verbs = [...VERBS];
  const nameW = Math.max(6, ...targets.map((t) => t.name.length));
  const header = "  " + "target".padEnd(nameW) + "   " + verbs.join("  ");
  log.info(pc.dim(header));
  for (const t of targets) {
    const cells = verbs.map((v) => cell(Boolean(t.commands[v as Verb]), v.length)).join("  ");
    log.info("  " + t.name.padEnd(nameW) + "   " + cells);
  }
}

function printGaps(targets: Target[]): void {
  const verbs = [...VERBS];
  const unwired = verbs.filter((v) => !targets.some((t) => t.commands[v as Verb]));
  if (unwired.length === 0) {
    log.ok("  all verbs wired");
    return;
  }
  for (const v of unwired) {
    if (v === "deploy") {
      log.dim("  deploy — not yet implemented (fast-follow).");
    } else {
      log.dim(`  ${v} — no ${v} script found; add one, or set commands.${v} in strand.json.`);
    }
  }
}

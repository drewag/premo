import { Command } from "commander";
import { execa } from "execa";
import pc from "picocolors";
import { VERBS, type Verb } from "../../manifest/types.js";
import { inspectContext } from "../../core/context.js";
import { resolvePackages } from "../../core/packages.js";
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
        return { ok: false, detail: "not running (only needed if a project uses docker)" };
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
  {
    name: "xcode tools",
    run: async () => {
      try {
        const { stdout } = await execa("xcodebuild", ["-version"]);
        return { ok: true, detail: stdout.split("\n")[0]!.trim() };
      } catch {
        return { ok: false, detail: "not installed (only needed for xcode projects)" };
      }
    },
  },
];

// --- gathering (shared by the human and JSON renderers) ---

interface ProjectReport {
  name: string;
  root: string;
  adopted: boolean;
  adapter: string | null;
  git: { repo: boolean; base: string | null };
  ports: { base: number; block: number } | null;
  background: { name: string; pid: number }[];
  packages: { name: string; commands: Record<Verb, string | null> }[];
  unwired: Verb[];
}

async function gatherProject(cwd: string): Promise<ProjectReport> {
  const { root, manifest, adopted, adapterName } = await inspectContext(cwd);
  const repo = await isGitRepo(root);
  const base = repo ? await resolveBase(root, manifest.changeBase) : null;
  const bg = await listBackground(root);
  const resolved = await resolvePackages(root, manifest);

  const packages = resolved.map((p) => ({
    name: p.name,
    commands: Object.fromEntries(VERBS.map((v) => [v, p.commands[v] ?? null])) as Record<
      Verb,
      string | null
    >,
  }));
  const unwired = [...VERBS].filter((v) => !resolved.some((p) => p.commands[v]));

  return {
    name: manifest.name,
    root,
    adopted,
    adapter: adapterName,
    git: { repo, base: base ?? null },
    ports: manifest.ports
      ? { base: manifest.ports.base, block: manifest.ports.block ?? 100 }
      : null,
    background: bg.map((p) => ({ name: p.name, pid: p.pid })),
    packages,
    unwired,
  };
}

export function register(program: Command): void {
  program
    .command("doctor")
    .description("Show host prerequisites and which verbs are wired in this project.")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const host = await Promise.all(
        hostChecks.map(async (c) => ({ name: c.name, ...(await c.run()) })),
      );
      const project = await gatherProject(process.cwd());

      if (opts.json) {
        log.json({ host, project });
        return;
      }

      log.info(pc.bold("Host"));
      for (const c of host) {
        if (c.ok) log.ok(`${c.name} — ${c.detail}`);
        else log.warn(`${c.name} — ${c.detail}`);
      }
      log.info("");
      renderProject(project);
    });
}

function renderProject(p: ProjectReport): void {
  log.info(pc.bold("Project"));
  log.info(`  ${p.name}  ${pc.dim(p.root)}`);
  log.info(
    `  premo.json   ${p.adopted ? pc.green("present") : pc.yellow("not yet — auto-adopts on first verb")}`,
  );
  log.info(`  adapter       ${p.adapter ?? pc.yellow("none (add commands manually)")}`);

  if (p.git.repo) {
    log.info(
      p.git.base
        ? `  git           repo; affected detection ready ${pc.dim(`(base ${p.git.base})`)}`
        : `  git           repo; ${pc.yellow("no base ref — build/test will run all targets")}`,
    );
  } else {
    log.info(`  git           ${pc.yellow("not a git repo — build/test will run all targets")}`);
  }

  log.info(
    p.ports
      ? `  ports         ${p.ports.base}–${p.ports.base + p.ports.block - 1}`
      : `  ports         ${pc.dim("none allocated")}`,
  );

  if (p.background.length > 0) {
    log.info(`  background    ${p.background.map((b) => `${b.name}(pid ${b.pid})`).join(", ")}`);
  }

  log.info("");
  log.info(pc.bold("  Verb wiring"));
  printMatrix(p.packages);

  log.info("");
  printGaps(p.unwired);
}

function cell(present: boolean, width: number): string {
  const sym = present ? pc.green("✓") : pc.dim("·");
  return sym + " ".repeat(Math.max(0, width - 1));
}

function printMatrix(packages: ProjectReport["packages"]): void {
  const verbs = [...VERBS];
  const nameW = Math.max(7, ...packages.map((p) => p.name.length));
  const header = "  " + "package".padEnd(nameW) + "   " + verbs.join("  ");
  log.info(pc.dim(header));
  for (const p of packages) {
    const cells = verbs.map((v) => cell(Boolean(p.commands[v]), v.length)).join("  ");
    log.info("  " + p.name.padEnd(nameW) + "   " + cells);
  }
}

function printGaps(unwired: Verb[]): void {
  if (unwired.length === 0) {
    log.ok("  all verbs wired");
    return;
  }
  for (const v of unwired) {
    if (v === "deploy") {
      log.dim("  deploy — set commands.deploy in premo.json to enable.");
    } else {
      log.dim(`  ${v} — no ${v} script found; add one, or set commands.${v} in premo.json.`);
    }
  }
}

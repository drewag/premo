import { Command } from "commander";
import { execa } from "execa";
import pc from "picocolors";
import { VERBS, type Verb } from "../../manifest/types.js";
import { inspectContext } from "../../core/context.js";
import { resolvePackages } from "../../core/packages.js";
import { resolveTargets } from "../../core/targets.js";
import { isGitRepo, resolveBase } from "../../core/git.js";
import { listBackground } from "../../core/supervise.js";
import { listInstances } from "../../core/data.js";
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

export interface ProjectReport {
  name: string;
  root: string;
  adopted: boolean;
  adapter: string | null;
  git: { repo: boolean; base: string | null };
  ports: { base: number; block: number } | null;
  background: { name: string; pid: number }[];
  packages: { name: string; commands: Record<Verb, string | null> }[];
  targets: { name: string; dev: boolean; deploy: boolean; default: boolean; port: number | null }[];
  environments: { name: string; default: boolean; deploy: boolean }[];
  data: {
    wired: boolean;
    mode: "directory" | "scripts" | null;
    dir: string | null;
    instances: number;
  };
  unwired: Verb[];
}

// build/test/lint are the package-axis verbs shown in the package matrix;
// dev/deploy are the target-axis verbs shown in the targets list (DESIGN §13).
const PKG_VERBS = ["build", "test", "lint"] as const;

export async function gatherProject(cwd: string): Promise<ProjectReport> {
  const { root, manifest, adopted, adapterName } = await inspectContext(cwd);
  const repo = await isGitRepo(root);
  const base = repo ? await resolveBase(root, manifest.changeBase) : null;
  const bg = await listBackground(root);
  const resolved = await resolvePackages(root, manifest);
  const resolvedTargets = await resolveTargets(root, manifest);

  const packages = resolved.map((p) => ({
    name: p.name,
    commands: Object.fromEntries(VERBS.map((v) => [v, p.commands[v] ?? null])) as Record<
      Verb,
      string | null
    >,
  }));
  const targets = resolvedTargets.map((t) => ({
    name: t.name,
    dev: t.dev.length > 0,
    deploy: !!t.deploy,
    default: t.isDefault,
    port: t.ports?.base ?? null,
  }));
  const environments = manifest.environments.map((e) => ({
    name: e.name,
    default: !!e.default,
    deploy: !!e.deploy,
  }));
  const dataState = await listInstances(root);
  const dataMode: "directory" | "scripts" | null = manifest.data
    ? manifest.data.dir
      ? "directory"
      : "scripts"
    : null;
  const data = {
    wired: !!manifest.data,
    mode: dataMode,
    dir: manifest.data?.dir ?? null,
    instances: dataState.instances.length,
  };

  // A verb is wired if its axis resolves it: build/test/lint from a package,
  // dev/deploy from a target.
  const unwired = [...VERBS].filter((v) => {
    if (v === "dev") return !targets.some((t) => t.dev);
    if (v === "deploy") return !targets.some((t) => t.deploy);
    return !resolved.some((p) => p.commands[v]);
  });

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
    targets,
    environments,
    data,
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

  if (p.data.wired) {
    const where = p.data.dir ? ` ${pc.dim(`(${p.data.dir})`)}` : "";
    const n = p.data.instances ? `, ${p.data.instances} instance(s)` : "";
    log.info(`  data          ${p.data.mode}${where}${n}`);
  }

  log.info("");
  log.info(pc.bold("  Packages") + pc.dim("  (build · test · lint)"));
  printMatrix(p.packages);

  log.info("");
  log.info(pc.bold("  Targets") + pc.dim("  (dev · deploy)"));
  printTargets(p.targets);

  log.info("");
  log.info(pc.bold("  Environments") + pc.dim("  (--env · DESIGN §15)"));
  printEnvironments(p.environments);

  log.info("");
  printGaps(p.unwired);
}

function cell(present: boolean, width: number): string {
  const sym = present ? pc.green("✓") : pc.dim("·");
  return sym + " ".repeat(Math.max(0, width - 1));
}

function printMatrix(packages: ProjectReport["packages"]): void {
  if (packages.length === 0) {
    log.dim("  (none detected)");
    return;
  }
  const verbs = [...PKG_VERBS];
  const nameW = Math.max(7, ...packages.map((p) => p.name.length));
  const header = "  " + "package".padEnd(nameW) + "   " + verbs.join("  ");
  log.info(pc.dim(header));
  for (const p of packages) {
    const cells = verbs.map((v) => cell(Boolean(p.commands[v]), v.length)).join("  ");
    log.info("  " + p.name.padEnd(nameW) + "   " + cells);
  }
}

function printTargets(targets: ProjectReport["targets"]): void {
  if (targets.length === 0) {
    log.dim("  (none — add a package with a dev script, or a target in premo.json)");
    return;
  }
  const nameW = Math.max(6, ...targets.map((t) => t.name.length));
  const header = "  " + "target".padEnd(nameW) + "   dev  deploy  port";
  log.info(pc.dim(header));
  for (const t of targets) {
    const flag = t.default ? pc.cyan(" (default)") : "";
    const port = pc.dim(t.port ? String(t.port) : "·");
    log.info(
      "  " +
        t.name.padEnd(nameW) +
        "   " +
        cell(t.dev, 3) +
        "  " +
        cell(t.deploy, 6) +
        "  " +
        port +
        flag,
    );
  }
}

function printEnvironments(environments: ProjectReport["environments"]): void {
  if (environments.length === 0) {
    log.dim("  (single default environment — add `environments` to premo.json to split dev/prod)");
    return;
  }
  const nameW = Math.max(4, ...environments.map((e) => e.name.length));
  log.info(pc.dim("  " + "env".padEnd(nameW) + "   default  deploy"));
  for (const e of environments) {
    log.info("  " + e.name.padEnd(nameW) + "   " + cell(e.default, 7) + "  " + cell(e.deploy, 6));
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

import type { Command } from "commander";
import pc from "picocolors";
import { VERBS, type Verb } from "../manifest/types.js";
import { inspectContext } from "../core/context.js";
import { resolvePackages } from "../core/packages.js";
import { resolveTargets } from "../core/targets.js";
import { log } from "../core/logger.js";

// Commands that support the day-to-day dev loop (shown as active alongside
// whichever verbs are wired), versus premo-management commands. `shell` is
// conditionally active — only when the project declares one.
const PROJECT_HELPERS = ["open", "share", "logs", "stop"];
const META = ["doctor", "adopt", "guide", "skill", "ports", "completion"];

// Every command name that one of the explicit groups above already places.
// `shell` is grouped conditionally (Active vs Not-wired) and `help` is
// Commander's built-in, so both are excluded from the "needs a home" check.
function groupedNames(): Set<string> {
  return new Set([...VERBS, ...PROJECT_HELPERS, ...META, "shell", "help"]);
}

// True when the invocation is a request for the top-level overview — no
// subcommand, or a bare help flag. `premo build --help` is NOT top-level.
export function isTopLevelHelp(argv: string[]): boolean {
  const args = argv.slice(2);
  if (args.length === 0) return true;
  if (args[0] === "-h" || args[0] === "--help") return true;
  if (args[0] === "help" && args.length === 1) return true;
  return false;
}

export async function printGroupedHelp(program: Command): Promise<void> {
  const byName = new Map(program.commands.map((c) => [c.name(), c]));
  const desc = (name: string) => byName.get(name)?.description() ?? "";

  let projectName: string | null = null;
  let shellAvailable = false;
  const wired = new Set<Verb>();
  // Project nouns the verbs take as `[target]` / `--env` (DESIGN §13, §15).
  let targetList: { name: string; isDefault: boolean }[] = [];
  let envList: { name: string; default?: boolean }[] = [];
  try {
    const insp = await inspectContext(process.cwd());
    if (insp.adopted || insp.adapterName) projectName = insp.manifest.name;
    const packages = await resolvePackages(insp.root, insp.manifest);
    for (const v of VERBS) if (packages.some((p) => p.commands[v])) wired.add(v);
    shellAvailable = Object.keys(insp.manifest.shells).length > 0;
    targetList = (await resolveTargets(insp.root, insp.manifest)).map((t) => ({
      name: t.name,
      isDefault: t.isDefault,
    }));
    envList = insp.manifest.environments;
  } catch {
    /* not in a usable project — every verb shows as not wired */
  }

  const activeVerbs = VERBS.filter((v) => wired.has(v));
  const inactiveVerbs = VERBS.filter((v) => !wired.has(v));

  log.info(`${pc.bold("premo")} — one set of verbs for every project.`);
  log.info("");
  log.info(`Usage: ${pc.cyan("premo <command> [options]")}`);
  log.info("");

  const activeHeader = projectName ? `Active  ${pc.dim(`(wired for ${projectName})`)}` : "Active";
  log.info(pc.bold(activeHeader));
  const activeExtra = shellAvailable ? ["shell"] : [];
  printRows([...activeVerbs, ...PROJECT_HELPERS, ...activeExtra].map((n) => [n, desc(n)]));
  if (activeVerbs.length === 0) {
    log.dim("  (no verbs wired yet — run `premo doctor`, or `premo adopt`)");
  }

  const inactive: [string, string][] = inactiveVerbs.map((v) => [v, inactiveReason(v)]);
  if (!shellAvailable) inactive.push(["shell", "no shell available here"]);
  if (inactive.length > 0) {
    log.info("");
    log.info(pc.bold("Not wired here"));
    printRows(inactive, true);
  }

  const projectRows: [string, string][] = [];
  if (targetList.length > 0) {
    projectRows.push([
      "targets",
      fmtNouns(targetList.map((t) => ({ name: t.name, mark: t.isDefault }))) +
        pc.dim("  — dev/deploy [target]"),
    ]);
  }
  if (envList.length > 0) {
    projectRows.push([
      "environments",
      fmtNouns(envList.map((e) => ({ name: e.name, mark: !!e.default }))) +
        pc.dim("  — --env <name>"),
    ]);
  }
  if (projectRows.length > 0) {
    log.info("");
    log.info(pc.bold("This project") + (projectName ? pc.dim(`  (${projectName})`) : ""));
    const width = Math.max(...projectRows.map(([n]) => n.length));
    for (const [name, val] of projectRows) log.info(`  ${pc.cyan(name.padEnd(width))}  ${val}`);
  }

  // Any registered command not placed by an explicit group still gets a home
  // here, so adding one to commands/index.ts can never make it invisible in help.
  const grouped = groupedNames();
  const ungrouped = program.commands.map((c) => c.name()).filter((n) => !grouped.has(n));

  log.info("");
  log.info(pc.bold("Manage premo"));
  printRows([...META, ...ungrouped].map((n) => [n, desc(n)]));

  log.info("");
  log.dim("Run `premo <command> --help` for details.");
}

function inactiveReason(v: Verb): string {
  if (v === "deploy") return "no deploy command — set commands.deploy in premo.json";
  return `no ${v} command — add a ${v} script or set commands.${v}`;
}

// Render a comma-separated noun list, tagging the marked one (the default
// target / environment) so `premo` (no args) shows what it'll pick.
function fmtNouns(items: { name: string; mark: boolean }[]): string {
  return items.map((i) => i.name + (i.mark ? pc.cyan(" (default)") : "")).join(", ");
}

function printRows(rows: [string, string][], dimAll = false): void {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map(([n]) => n.length));
  for (const [name, d] of rows) {
    if (dimAll) log.info(pc.dim(`  ${name.padEnd(width)}  ${d}`));
    else log.info(`  ${pc.cyan(name.padEnd(width))}  ${pc.dim(d)}`);
  }
}

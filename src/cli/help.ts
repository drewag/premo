import type { Command } from "commander";
import pc from "picocolors";
import { VERBS, type Verb } from "../premo-api/types.js";
import { inspectContext } from "../core/context.js";
import { resolveTargets } from "../core/targets.js";
import { log } from "../core/logger.js";

// Commands that support the day-to-day dev loop (shown as active alongside
// whichever verbs are wired), versus premo-management commands. `shell` is
// conditionally active — only when the project declares one.
const PROJECT_HELPERS = ["open", "logs", "stop"];
const META = ["doctor", "adopt", "ports"];

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
  try {
    const insp = await inspectContext(process.cwd());
    if (insp.adopted || insp.adapterName) projectName = insp.manifest.name;
    const targets = await resolveTargets(insp.root, insp.manifest);
    for (const v of VERBS) if (targets.some((t) => t.commands[v])) wired.add(v);
    shellAvailable = Object.keys(insp.manifest.shells).length > 0;
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

  log.info("");
  log.info(pc.bold("Manage premo"));
  printRows(META.map((n) => [n, desc(n)]));

  log.info("");
  log.dim("Run `premo <command> --help` for details.");
}

function inactiveReason(v: Verb): string {
  if (v === "deploy") return "no deploy command — set commands.deploy in premo.json";
  return `no ${v} command — add a ${v} script or set commands.${v}`;
}

function printRows(rows: [string, string][], dimAll = false): void {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map(([n]) => n.length));
  for (const [name, d] of rows) {
    if (dimAll) log.info(pc.dim(`  ${name.padEnd(width)}  ${d}`));
    else log.info(`  ${pc.cyan(name.padEnd(width))}  ${pc.dim(d)}`);
  }
}

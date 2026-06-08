import type { Argument, Command, Option } from "commander";
import { inspectContext } from "./context.js";
import { resolvePackages } from "./packages.js";
import { resolveTargets } from "./targets.js";

// Reflection-driven shell completion. Command names, flags, and option/argument
// metadata all come from introspecting the Commander program, so new verbs and
// options are completed automatically. Only genuinely dynamic value sources are
// wired below, keyed by argument/option NAME — so the convention "a positional
// named `target` gets target completion" covers future verbs for free.

export interface Candidate {
  value: string;
  description?: string;
}

// --- dynamic value sources (read-only; best-effort) ---

// The `[target]` positional spans both axes — build/test/lint take a package,
// dev/deploy take a target — so complete the union of both names.
async function targetNames(cwd: string): Promise<string[]> {
  const { root, manifest } = await inspectContext(cwd);
  const [packages, targets] = await Promise.all([
    resolvePackages(root, manifest),
    resolveTargets(root, manifest),
  ]);
  return [...new Set([...packages.map((p) => p.name), ...targets.map((t) => t.name)])].sort();
}

async function shellNames(cwd: string): Promise<string[]> {
  const { manifest } = await inspectContext(cwd);
  return Object.keys(manifest.shells);
}

async function envNames(cwd: string): Promise<string[]> {
  const { manifest } = await inspectContext(cwd);
  return manifest.deploy?.envs ?? ["prod"];
}

// Soft suggestions — NOT a hard enum: `--platform` parsing is intentionally
// fuzzy (see core/xcode.ts), so we suggest without constraining.
const PLATFORMS = ["ios", "macos", "visionos", "ios-device"];

type Provider = (cwd: string) => string[] | Promise<string[]>;

// Positional arguments keyed by Argument.name().
const ARG_PROVIDERS: Record<string, Provider> = {
  target: targetNames,
};
// Positional arguments that need the command name to disambiguate (`cmd:arg`).
const CMD_ARG_PROVIDERS: Record<string, Provider> = {
  "shell:name": shellNames,
  "completion:shell": () => ["zsh", "bash", "fish"],
};
// Option values keyed by Option.name() (camelCase).
const OPT_PROVIDERS: Record<string, Provider> = {
  platform: () => PLATFORMS,
  env: envNames,
};
// Positionals we deliberately don't complete (`cmd:arg`); keeps the meta-test honest.
export const UNCOMPLETED = new Set<string>();

// Internal commands (e.g. `__complete`) are hidden from command-name completion.
function isInternal(cmd: Command): boolean {
  return cmd.name().startsWith("__");
}

// The coverage predicate, shared with the meta-test: a positional argument is
// "covered" if it has fixed choices, a registered provider, or is allow-listed.
export function positionalIsCovered(cmdName: string, arg: Argument): boolean {
  return Boolean(
    arg.argChoices?.length ||
    CMD_ARG_PROVIDERS[`${cmdName}:${arg.name()}`] ||
    ARG_PROVIDERS[arg.name()] ||
    UNCOMPLETED.has(`${cmdName}:${arg.name()}`),
  );
}

async function optionValues(opt: Option, cwd: string): Promise<string[]> {
  if (opt.argChoices?.length) return opt.argChoices;
  const provider = OPT_PROVIDERS[opt.name()];
  return provider ? Promise.resolve(provider(cwd)) : [];
}

async function argValues(cmdName: string, arg: Argument, cwd: string): Promise<string[]> {
  if (arg.argChoices?.length) return arg.argChoices;
  const provider = CMD_ARG_PROVIDERS[`${cmdName}:${arg.name()}`] ?? ARG_PROVIDERS[arg.name()];
  return provider ? Promise.resolve(provider(cwd)) : [];
}

// Candidates for the current completion position. `words` is the tokens after
// `premo`, including the (possibly empty) current word as the last element.
// Never throws — any failure yields no candidates so TAB never hangs.
export async function completionCandidates(
  words: string[],
  cwd: string,
  program: Command,
): Promise<Candidate[]> {
  try {
    return await resolve(words, cwd, program);
  } catch {
    return [];
  }
}

async function resolve(words: string[], cwd: string, program: Command): Promise<Candidate[]> {
  // Completing the command name itself.
  if (words.length <= 1) {
    return program.commands
      .filter((c) => !isInternal(c))
      .map((c) => ({ value: c.name(), description: c.description() }));
  }

  const cmdName = words[0]!;
  const cmd = program.commands.find((c) => c.name() === cmdName || c.aliases().includes(cmdName));
  if (!cmd) return [];

  const current = words[words.length - 1] ?? "";
  const prev = words[words.length - 2] ?? "";

  // Completing an option flag.
  if (current.startsWith("-")) {
    return cmd.options
      .filter((o) => !o.hidden && o.long)
      .map((o) => ({ value: o.long!, description: o.description }));
  }

  // Completing an option's value (the previous token is a value-taking option).
  if (prev.startsWith("-")) {
    const opt = cmd.options.find((o) => o.long === prev || o.short === prev);
    if (opt && (opt.required || opt.optional)) {
      return (await optionValues(opt, cwd)).map((v) => ({ value: v }));
    }
  }

  // Completing the command's first positional argument.
  const arg = cmd.registeredArguments[0];
  if (arg) {
    return (await argValues(cmd.name(), arg, cwd)).map((v) => ({ value: v }));
  }
  return [];
}

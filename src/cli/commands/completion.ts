import path from "node:path";
import { Command } from "commander";
import { buildProgram } from "../program.js";
import { completionCandidates } from "../../core/completion.js";
import { log } from "../../core/logger.js";
import { COMMANDS } from "./index.js";

type Shell = "zsh" | "bash" | "fish";

// The stubs are intentionally tiny and stable: they only forward the current
// line to `premo __complete` and feed the result back. All completion logic
// lives server-side (reflection-driven), so these never change as verbs grow.
const STUBS: Record<Shell, string> = {
  zsh: `#compdef premo
_premo() {
  local -a raw entries
  local line
  raw=("\${(@f)$(premo __complete -- "\${(@)words[2,$CURRENT]}" 2>/dev/null)}")
  for line in $raw; do
    [[ -z $line ]] && continue
    entries+=("\${line/$'\\t'/:}")   # zsh _describe wants value:description
  done
  _describe -t premo 'premo' entries
}
compdef _premo premo
`,
  bash: `_premo() {
  local args out line
  COMPREPLY=()
  args=("\${COMP_WORDS[@]:1:COMP_CWORD}")   # tokens after 'premo', incl. current
  out=$(premo __complete -- "\${args[@]}" 2>/dev/null)
  local -a vals=()
  while IFS= read -r line; do
    [[ -z $line ]] && continue
    vals+=("\${line%%$'\\t'*}")              # drop the description
  done <<< "$out"
  COMPREPLY=($(compgen -W "\${vals[*]}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _premo premo
`,
  fish: `function __premo_complete
  set -l tokens (commandline -opc) (commandline -ct)
  premo __complete -- $tokens[2..-1] 2>/dev/null
end
complete -c premo -f -a '(__premo_complete)'
`,
};

function detectShell(explicit: string | undefined): Shell | null {
  const name = (explicit ?? path.basename(process.env.SHELL ?? "")).toLowerCase();
  if (name.includes("zsh")) return "zsh";
  if (name.includes("bash")) return "bash";
  if (name.includes("fish")) return "fish";
  return null;
}

export function register(program: Command): void {
  program
    .command("completion [shell]")
    .description("Print a shell completion script (zsh|bash|fish). Defaults to $SHELL.")
    .action((shellArg: string | undefined) => {
      const shell = detectShell(shellArg);
      if (!shell) {
        log.error(
          `Unknown shell ${shellArg ? `"${shellArg}"` : `(set $SHELL or pass one)`}. Supported: zsh, bash, fish.`,
        );
        process.exitCode = 1;
        return;
      }
      process.stdout.write(STUBS[shell]);
    });

  // Internal: the completion engine the stubs call on every TAB. Hidden, and
  // excluded from command-name completion (its name starts with `__`). It reads
  // the line words after `--` raw (so flags like `--all` aren't parsed as ours).
  program
    .command("__complete", { hidden: true })
    .allowUnknownOption()
    .argument("[words...]")
    .action(async (words: string[]) => {
      const program2 = buildProgram(COMMANDS);
      const candidates = await completionCandidates(words ?? [], process.cwd(), program2);
      for (const c of candidates) {
        process.stdout.write(c.description ? `${c.value}\t${c.description}\n` : `${c.value}\n`);
      }
    });
}

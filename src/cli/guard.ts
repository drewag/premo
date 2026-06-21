import { findProjectRoot } from "../core/project.js";
import { log } from "../core/logger.js";

// Shared precondition for commands that require an adopted project. On failure it
// prints one canonical message and sets a failing exit code, then returns null —
// the caller just `if (!root) return;`. Keeps the message and exit handling
// consistent across commands instead of each hand-rolling the guard. Pass
// `{ json: true }` for a `--json` command so the failure is emitted as
// `{ "error": "not-a-premo-project" }` instead of a human line.
export function requireProjectRoot(
  cwd: string = process.cwd(),
  { json = false }: { json?: boolean } = {},
): string | null {
  const root = findProjectRoot(cwd);
  if (!root) {
    if (json) log.json({ error: "not-a-premo-project" });
    else log.error("Not in a premo project (no premo.json found).");
    process.exitCode = 1;
  }
  return root;
}

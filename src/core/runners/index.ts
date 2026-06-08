import type { Script, Verb, XcodeConfig } from "../../manifest/types.js";
import { xcodeRunner } from "./xcode.js";

// A Runner owns the recipe for a predefined ScriptSpec: given a verb and the
// unit's declarative facts, it returns the shell command premo runs — generated
// live, never baked into premo.json. This is how premo *owns* multi-step
// build/run complexity instead of materializing it into every repo's config. The
// command stays a shell string so the dev supervisor (output prefixing, restart,
// device-lock detection) plugs in unchanged. xcode is the first; more (compose,
// make, …) register here and extend ScriptSpec's `run` enum.
export interface RunnerContext {
  // The xcode block governing this unit, when it's a native Apple app.
  xcode?: XcodeConfig;
}

export interface Runner {
  name: string; // matches the ScriptSpec `run` tag
  // The command for `verb`, or null when this runner doesn't own that verb (e.g.
  // xcode owns dev/build/test but not lint) or lacks the facts to build it.
  command(verb: Verb, ctx: RunnerContext): string | null;
}

const RUNNERS: Runner[] = [xcodeRunner];

export function getRunner(name: string): Runner | null {
  return RUNNERS.find((r) => r.name === name) ?? null;
}

// Resolve a Script (raw string or predefined spec) to the concrete shell command
// for `verb`. A string passes through; a spec is dispatched to its runner.
// Returns undefined when a spec's runner can't produce a command (unknown runner,
// verb it doesn't own, or missing facts) so the caller falls through.
export function resolveScript(script: Script, verb: Verb, ctx: RunnerContext): string | undefined {
  if (typeof script === "string") return script;
  return getRunner(script.run)?.command(verb, ctx) ?? undefined;
}

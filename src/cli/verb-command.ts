import { Command } from "commander";
import { ensureContext } from "../core/context.js";
import { runVerb } from "../core/run.js";
import type { Verb } from "../manifest/types.js";
import { resolveXcodeEnv } from "./xcode-env.js";

interface VerbOpts {
  all?: boolean;
  env?: string;
  device?: string;
  platform?: string;
}

// build and test are identical: an optional [target], the same --all / --env /
// --device / --platform flags, xcode-env resolution, and an affected-by-default
// run of the verb. This factory is their single definition — lint and deploy
// differ enough (affected:false / its own ship flow) to stay bespoke.
export function registerAffectedVerb(program: Command, verb: Verb): void {
  program
    .command(verb)
    .description(`${cap(verb)} the affected targets (default), one target, or --all.`)
    .argument("[target]", `${verb} a single target`)
    .option("--all", `${verb} every target, not just affected`)
    .option("-e, --env <name>", `environment to ${verb} (e.g. dev | prod); see premo.json`)
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .action(async (target: string | undefined, opts: VerbOpts) => {
      const ctx = await ensureContext(process.cwd());
      const env = await resolveXcodeEnv(ctx, opts, false, false, target);
      if (env === null) {
        process.exitCode = 1;
        return;
      }
      await runVerb(ctx, verb, { target, all: opts.all, affected: true, env });
    });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

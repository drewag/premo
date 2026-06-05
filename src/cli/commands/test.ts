import { Command } from "commander";
import { ensureContext } from "../../core/context.js";
import { runVerb } from "../../core/run.js";
import { resolveXcodeEnv } from "../xcode-env.js";

export function register(program: Command): void {
  program
    .command("test")
    .description("Test the affected targets (default), one target, or --all.")
    .argument("[target]", "test a single target")
    .option("--all", "test every target, not just affected")
    .option("--device <name>", "destination device/simulator (xcode projects)")
    .option("--platform <name>", "destination platform: ios | macos | visionos (xcode projects)")
    .action(
      async (
        target: string | undefined,
        opts: { all?: boolean; device?: string; platform?: string },
      ) => {
        const ctx = await ensureContext(process.cwd());
        const env = await resolveXcodeEnv(ctx, opts, false);
        if (env === null) {
          process.exitCode = 1;
          return;
        }
        await runVerb(ctx, "test", { target, all: opts.all, affected: true, env });
      },
    );
}

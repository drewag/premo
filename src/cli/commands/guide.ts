import { Command } from "commander";
import { gatherSkillContext } from "../../core/skill.js";
import { renderGuide } from "../../core/agents-doc.js";
import { log } from "../../core/logger.js";

// `premo guide` is the on-demand half of the discovery tier (see agents-doc.ts):
// the AGENTS.md block points coding agents here for the full manual, generated
// fresh from the installed binary plus this repo's resolved verbs.
export function register(program: Command): void {
  program
    .command("guide")
    .description("Print the full premo reference for this repo (for humans and coding agents).")
    .option("--json", "emit the resolved context as JSON instead of the prose guide")
    .action(async (opts: { json?: boolean }) => {
      const ctx = await gatherSkillContext(process.cwd());
      if (opts.json) {
        log.json(ctx);
        return;
      }
      process.stdout.write(renderGuide(ctx));
    });
}

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { gatherSkillContext, renderSkill, SKILL_FILE } from "../../core/skill.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("skill")
    .description("Emit a SKILL.md that teaches a coding agent how to wire premo for this repo.")
    .option("--json", "emit the skill context as JSON instead of writing SKILL.md")
    .option("--stdout", "print the SKILL.md to stdout instead of writing a file")
    .option("-f, --force", "overwrite an existing SKILL.md")
    .action(async (opts: { json?: boolean; stdout?: boolean; force?: boolean }) => {
      const ctx = await gatherSkillContext(process.cwd());

      if (opts.json) {
        log.json(ctx);
        return;
      }

      const doc = renderSkill(ctx);
      if (opts.stdout) {
        process.stdout.write(doc);
        return;
      }

      const target = path.join(ctx.root, SKILL_FILE);
      if (existsSync(target) && !opts.force) {
        log.warn(
          `${SKILL_FILE} already exists — pass --force to overwrite, or --stdout to preview.`,
        );
        process.exitCode = 1;
        return;
      }
      await writeFile(target, doc, "utf8");
      const remaining = ctx.unwired.length;
      log.ok(`wrote ${SKILL_FILE} — ${remaining} verb(s) left to wire. Hand it to a coding agent.`);
    });
}

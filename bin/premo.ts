#!/usr/bin/env node
import { buildProgram } from "../src/cli/program.js";
import { isTopLevelHelp, printGroupedHelp } from "../src/cli/help.js";
import { COMMANDS } from "../src/cli/commands/index.js";
import { log } from "../src/core/logger.js";

const program = buildProgram(COMMANDS);

try {
  if (isTopLevelHelp(process.argv)) {
    await printGroupedHelp(program);
  } else {
    await program.parseAsync(process.argv);
  }
} catch (err) {
  // Commander reports and exits on its own parse errors; this catches unexpected
  // action failures (e.g. an invalid premo.json) so users get a clean message
  // instead of a raw stack trace.
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

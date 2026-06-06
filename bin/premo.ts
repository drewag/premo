#!/usr/bin/env node
import { buildProgram } from "../src/cli/program.js";
import { isTopLevelHelp, printGroupedHelp } from "../src/cli/help.js";
import { COMMANDS } from "../src/cli/commands/index.js";

const program = buildProgram(COMMANDS);

if (isTopLevelHelp(process.argv)) {
  await printGroupedHelp(program);
} else {
  await program.parseAsync(process.argv);
}

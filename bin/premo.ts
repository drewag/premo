#!/usr/bin/env -S npx tsx
import { buildProgram } from "../src/cli/registry.js";
import { isTopLevelHelp, printGroupedHelp } from "../src/cli/help.js";
import { register as doctor } from "../src/cli/commands/doctor.js";
import { register as adopt } from "../src/cli/commands/adopt.js";
import { register as dev } from "../src/cli/commands/dev.js";
import { register as build } from "../src/cli/commands/build.js";
import { register as test } from "../src/cli/commands/test.js";
import { register as lint } from "../src/cli/commands/lint.js";
import { register as deploy } from "../src/cli/commands/deploy.js";
import { register as stop } from "../src/cli/commands/stop.js";
import { register as logs } from "../src/cli/commands/logs.js";
import { register as ports } from "../src/cli/commands/ports.js";
import { register as open } from "../src/cli/commands/open.js";
import { register as shell } from "../src/cli/commands/shell.js";

const program = buildProgram([
  doctor,
  adopt,
  dev,
  build,
  test,
  lint,
  deploy,
  stop,
  logs,
  ports,
  open,
  shell,
]);

if (isTopLevelHelp(process.argv)) {
  await printGroupedHelp(program);
} else {
  await program.parseAsync(process.argv);
}

#!/usr/bin/env -S npx tsx
import { buildProgram } from "../src/cli/registry.js";
import { register as doctor } from "../src/cli/commands/doctor.js";
import { register as newCmd } from "../src/cli/commands/new.js";
import { register as dev } from "../src/cli/commands/dev.js";
import { register as stop } from "../src/cli/commands/stop.js";
import { register as list } from "../src/cli/commands/list.js";
import { register as ports } from "../src/cli/commands/ports.js";

const program = buildProgram([doctor, newCmd, dev, stop, list, ports]);
await program.parseAsync(process.argv);

import type { RegisterFn } from "../program.js";
import { register as doctor } from "./doctor.js";
import { register as adopt } from "./adopt.js";
import { register as dev } from "./dev.js";
import { register as build } from "./build.js";
import { register as test } from "./test.js";
import { register as lint } from "./lint.js";
import { register as deploy } from "./deploy.js";
import { register as stop } from "./stop.js";
import { register as logs } from "./logs.js";
import { register as ports } from "./ports.js";
import { register as open } from "./open.js";
import { register as share } from "./share.js";
import { register as shell } from "./shell.js";
import { register as skill } from "./skill.js";
import { register as guide } from "./guide.js";
import { register as completion } from "./completion.js";

// The single source of truth for which commands exist. Both bin/premo.ts and the
// completion engine build the program from this list, so adding a command here is
// all it takes for it to appear in the CLI and in shell completion.
export const COMMANDS: RegisterFn[] = [
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
  share,
  shell,
  skill,
  guide,
  completion,
];

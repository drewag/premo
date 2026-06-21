import { Command } from "commander";
import { registerAffectedVerb } from "../verb-command.js";

export function register(program: Command): void {
  registerAffectedVerb(program, "build");
}

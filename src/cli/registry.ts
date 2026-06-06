import { Command } from "commander";

export type RegisterFn = (program: Command) => void;

export function buildProgram(registrations: RegisterFn[]): Command {
  const program = new Command();
  program
    .name("premo")
    .description("One set of verbs — dev, build, test, lint, deploy — for every project.")
    .version("0.0.0");
  for (const reg of registrations) reg(program);
  return program;
}

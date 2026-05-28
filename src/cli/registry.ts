import { Command } from "commander";

export type RegisterFn = (program: Command) => void;

export function buildProgram(registrations: RegisterFn[]): Command {
  const program = new Command();
  program.name("strand").description("Scaffold and run component-based projects.").version("0.0.0");
  for (const reg of registrations) reg(program);
  return program;
}

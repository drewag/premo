import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

export type RegisterFn = (program: Command) => void;

// Read premo's own version from its package.json, walking up from this file so
// it works the same in dev (src/cli/) and in the published build (dist/src/cli/).
function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "premo") return pkg.version ?? "0.0.0";
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

export function buildProgram(registrations: RegisterFn[]): Command {
  const program = new Command();
  program
    .name("premo")
    .description("One set of verbs — dev, build, test, lint, deploy — for every project.")
    .version(readVersion());
  for (const reg of registrations) reg(program);
  return program;
}

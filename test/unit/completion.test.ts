import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProgram } from "../../src/cli/program.js";
import { COMMANDS } from "../../src/cli/commands/index.js";
import { completionCandidates, positionalIsCovered } from "../../src/core/completion.js";

const program = buildProgram(COMMANDS);
const visible = program.commands.filter((c) => !c.name().startsWith("__"));

async function values(words: string[], cwd = process.cwd()): Promise<string[]> {
  return (await completionCandidates(words, cwd, program)).map((c) => c.value);
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "premo-comp-"));
  await writeFile(
    path.join(dir, "premo.json"),
    JSON.stringify({
      name: "demo",
      commands: { dev: "x" },
      packages: [
        { name: "web", dirs: ["web/"] },
        { name: "api", dirs: ["api/"] },
      ],
      shells: { db: { kind: "command", command: ["psql"] } },
      deploy: { envs: ["prod", "staging"] },
    }),
  );
  return dir;
}

describe("completion — self-maintenance guard", () => {
  it("top-level completion offers every visible command", async () => {
    const got = new Set(await values([""]));
    for (const c of visible) expect(got.has(c.name())).toBe(true);
  });

  it("hides internal commands (e.g. __complete)", async () => {
    expect(await values([""])).not.toContain("__complete");
  });

  it("every command's positional argument is covered by completion", () => {
    const gaps: string[] = [];
    for (const cmd of visible) {
      for (const arg of cmd.registeredArguments) {
        if (!positionalIsCovered(cmd.name(), arg)) gaps.push(`${cmd.name()} [${arg.name()}]`);
      }
    }
    // If this fails, a new positional arg needs a provider, the name `target`,
    // or an entry in UNCOMPLETED — see src/core/completion.ts.
    expect(gaps).toEqual([]);
  });

  it("the guard actually catches an uncovered positional", () => {
    const stray = new Command("stray").argument("[widget]");
    expect(positionalIsCovered("stray", stray.registeredArguments[0]!)).toBe(false);
  });
});

describe("completion — dynamic values", () => {
  it("completes [target] from the project's premo.json", async () => {
    const dir = await fixture();
    expect((await values(["dev", ""], dir)).sort()).toEqual(["api", "web"]);
    // works for any verb that takes [target]
    expect((await values(["build", ""], dir)).sort()).toEqual(["api", "web"]);
  });

  it("completes shell names", async () => {
    const dir = await fixture();
    expect(await values(["shell", ""], dir)).toEqual(["db"]);
  });

  it("completes deploy --env from configured envs", async () => {
    const dir = await fixture();
    expect(await values(["deploy", "--env", ""], dir)).toEqual(["prod", "staging"]);
  });

  it("suggests platforms for dev --platform (soft, not enforced)", async () => {
    expect(await values(["dev", "--platform", ""])).toContain("ios");
  });

  it("completes option flags after a dash", async () => {
    const flags = await values(["build", "-"]);
    expect(flags).toContain("--all");
    expect(flags).toContain("--platform");
  });

  it("returns nothing for an unknown command", async () => {
    expect(await values(["nope", ""])).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli/program.js";
import { COMMANDS } from "../../src/cli/commands/index.js";
import { printGroupedHelp } from "../../src/cli/help.js";

// Guards the regression where `guide` was registered but absent from every help
// group (so it never showed in `premo --help`). printGroupedHelp now routes any
// command not placed by an explicit group into "Manage premo", so this asserts
// the invariant directly: every registered command appears in the grouped help.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printGroupedHelp", () => {
  it("lists every registered command somewhere in the output", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ""));
    });
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ""));
    });

    const program = buildProgram(COMMANDS);
    await printGroupedHelp(program);

    const output = lines.join("\n");
    const names = program.commands.map((c) => c.name()).filter((n) => n !== "help");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      // a command is "shown" if its name heads one of the rendered rows
      const shown = lines.some((l) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(l));
      expect(shown, `command "${name}" is missing from \`premo --help\``).toBe(true);
    }
    expect(output).toContain("guide"); // the specific command that regressed
  });
});

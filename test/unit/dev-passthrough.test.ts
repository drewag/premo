import { describe, expect, it } from "vitest";
import { splitPassthrough } from "../../src/cli/commands/dev.js";

// argv mirrors process.argv (node, script, "dev", ...). The second arg is what
// Commander binds to [target] (the first operand, even if it lives after `--`).
describe("splitPassthrough", () => {
  it("treats everything after `--` as passthrough and drops the mis-bound target", () => {
    const argv = ["node", "premo", "dev", "--", "doctor", "--json"];
    expect(splitPassthrough(argv, "doctor")).toEqual({
      target: undefined,
      passthrough: ["doctor", "--json"],
    });
  });

  it("keeps a real target that precedes `--`", () => {
    const argv = ["node", "premo", "dev", "web", "--", "foo"];
    expect(splitPassthrough(argv, "web")).toEqual({ target: "web", passthrough: ["foo"] });
  });

  it("passes a plain target through untouched when there is no `--`", () => {
    const argv = ["node", "premo", "dev", "web"];
    expect(splitPassthrough(argv, "web")).toEqual({ target: "web", passthrough: [] });
  });

  it("handles a bare `dev` with no target and no passthrough", () => {
    expect(splitPassthrough(["node", "premo", "dev"], undefined)).toEqual({
      target: undefined,
      passthrough: [],
    });
  });

  it("ignores options before `--` and still captures passthrough", () => {
    const argv = ["node", "premo", "dev", "--background", "--", "doctor"];
    expect(splitPassthrough(argv, "doctor")).toEqual({
      target: undefined,
      passthrough: ["doctor"],
    });
  });
});

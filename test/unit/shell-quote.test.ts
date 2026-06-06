import { describe, expect, it } from "vitest";
import { shq } from "../../src/core/shell.js";

describe("shq", () => {
  it("leaves bare words alone and single-quotes the rest", () => {
    expect(shq("Awooga")).toBe("Awooga");
    expect(shq("My Scheme")).toBe("'My Scheme'");
    expect(shq("it's")).toBe("'it'\\''s'");
  });
});

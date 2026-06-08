import { describe, expect, it } from "vitest";
import { multiSelectFromList } from "../../src/core/select.js";

// Off a TTY (vitest has no interactive stdin), the picker must not draw or hang —
// it returns the preselected set, which is what `premo deploy --yes` / CI rely on.
describe("multiSelectFromList (non-TTY)", () => {
  it("returns the preselected indices without prompting", async () => {
    const chosen = await multiSelectFromList(["a", "b", "c"], {
      preselected: [true, false, true],
    });
    expect(chosen).toEqual([0, 2]);
  });

  it("returns an empty array when nothing is preselected", async () => {
    expect(await multiSelectFromList(["a", "b"])).toEqual([]);
  });

  it("returns an empty array for an empty list", async () => {
    expect(await multiSelectFromList([])).toEqual([]);
  });
});

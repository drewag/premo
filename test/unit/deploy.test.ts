import { describe, expect, it } from "vitest";
import { nextVersionFromTags, todayStamp } from "../../src/core/version.js";
import { deployRef } from "../../src/core/deploy.js";

describe("nextVersionFromTags", () => {
  const today = "2026.06.04";

  it("starts at .1 when there are no tags for today", () => {
    expect(nextVersionFromTags([], today)).toBe("2026.06.04.1");
  });

  it("increments past the highest counter across all targets today", () => {
    const tags = [
      "release/drewag-me/2026.06.04.1",
      "release/drewag-me/2026.06.04.3",
      "release/other/2026.06.04.2",
    ];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.4");
  });

  it("ignores tags from other days", () => {
    const tags = ["release/drewag-me/2026.06.03.9", "release/drewag-me/2026.05.01.5"];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.1");
  });

  it("ignores malformed tags", () => {
    const tags = ["release/x/not-a-version", "weird", "release/x/2026.06.04.2"];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.3");
  });

  it("todayStamp formats as YYYY.MM.DD", () => {
    expect(todayStamp(new Date("2026-06-04T12:00:00"))).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });
});

describe("deployRef", () => {
  it("omits the env segment for a single env", () => {
    expect(deployRef("drewag-me", "prod", false)).toBe("deployed/drewag-me");
  });

  it("includes the env segment when multiple envs are configured", () => {
    expect(deployRef("drewag-me", "staging", true)).toBe("deployed/staging/drewag-me");
  });
});

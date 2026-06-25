import { describe, expect, it } from "vitest";
import { xcodeDescriptor } from "../../src/cli/commands/dev.js";

describe("xcodeDescriptor", () => {
  it("is undefined for a non-xcode run (no PREMO_XCODE_DEST)", () => {
    expect(xcodeDescriptor({})).toBeUndefined();
    expect(xcodeDescriptor({ PORT: "3000" })).toBeUndefined();
  });

  it("reports a simulator's specific udid, platform, scheme, and bundle id", () => {
    const desc = xcodeDescriptor({
      PREMO_XCODE_DEST: "platform=iOS Simulator,id=ABCD-1234",
      PREMO_XCODE_SCHEME: "MyApp",
      PREMO_XCODE_BOOT_UDID: "ABCD-1234",
      PREMO_XCODE_BUNDLE_ID: "com.example.MyApp",
      PREMO_XCODE_QUIET: "-quiet",
    });
    expect(desc).toEqual({
      scheme: "MyApp",
      destination: "platform=iOS Simulator,id=ABCD-1234",
      platform: "iOS Simulator",
      udid: "ABCD-1234",
      kind: "simulator",
      bundleId: "com.example.MyApp",
    });
  });

  it("marks a physical device run with its device udid", () => {
    const desc = xcodeDescriptor({
      PREMO_XCODE_DEST: "id=00008120-001E",
      PREMO_XCODE_SCHEME: "MyApp",
      PREMO_XCODE_DEVICE_UDID: "00008120-001E",
    });
    expect(desc).toMatchObject({ kind: "device", udid: "00008120-001E" });
    expect(desc?.platform).toBeUndefined(); // a bare `id=…` destination has no platform=
  });

  it("marks a Mac run with no udid", () => {
    const desc = xcodeDescriptor({
      PREMO_XCODE_DEST: "platform=macOS",
      PREMO_XCODE_SCHEME: "MyApp",
    });
    expect(desc).toEqual({
      scheme: "MyApp",
      destination: "platform=macOS",
      platform: "macOS",
      kind: "mac",
    });
  });
});

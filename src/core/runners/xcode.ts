import type { XcodeConfig } from "../../manifest/types.js";
import { xcodeCommands } from "../xcode.js";
import { shq } from "../shell.js";
import type { Runner } from "./index.js";

// The `-workspace X` / `-project X` flag for an xcode block (paths relative to
// the unit the block belongs to — repo root, or a monorepo member's dir).
function flag(x: XcodeConfig): string {
  return x.workspace ? `-workspace ${shq(x.workspace)}` : `-project ${shq(x.project ?? "")}`;
}

// Generates the dev/build/test commands live from a resolved `xcode` block, so
// the recipe lives here (versioned, upgradeable) instead of baked into config.
// Project + scheme are stable; the per-run destination is threaded in as
// PREMO_XCODE_DEST by the env layer (see core/xcode/env). lint/deploy aren't
// xcode-owned (lint is swiftlint, resolved by the adapter), so they return null.
export const xcodeRunner: Runner = {
  name: "xcode",
  command(verb, { xcode }) {
    if (!xcode) return null;
    const c = xcodeCommands(flag(xcode), xcode.scheme);
    switch (verb) {
      case "dev":
        return c.dev;
      case "build":
        return c.build;
      case "test":
        return c.test;
      default:
        return null;
    }
  },
};

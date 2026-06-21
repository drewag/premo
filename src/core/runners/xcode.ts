import { xcodeCommands, xcodeTargetFlag } from "../xcode.js";
import type { Runner } from "./index.js";

// Generates the dev/build/test commands live from a resolved `xcode` block, so
// the recipe lives here (versioned, upgradeable) instead of baked into config.
// The project path is the only stable input; the per-run destination and the
// active environment's scheme are threaded in as PREMO_XCODE_DEST /
// PREMO_XCODE_SCHEME by the env layer (see core/xcode/env), so the command is
// env-agnostic and `--env` need not reach target resolution. lint/deploy aren't
// xcode-owned (lint is swiftlint, resolved by the adapter), so they return null.
export const xcodeRunner: Runner = {
  name: "xcode",
  command(verb, { xcode }) {
    if (!xcode) return null;
    const c = xcodeCommands(xcodeTargetFlag(xcode));
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

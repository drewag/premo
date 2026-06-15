import type { XcodeConfig } from "../../manifest/types.js";
import { pickXcodeEnv } from "../../manifest/environments.js";
import { writeLastXcodeDest } from "../local.js";
import { resolveDestination } from "./destinations.js";

// The PREMO_XCODE_* env a verb run needs, or {} when there's no xcode config (a
// non-Apple project). Resolves the two per-run variables (DESIGN §15.3): the
// destination (flag → default → optional interactive pick) as PREMO_XCODE_DEST,
// and the active environment's scheme/bundleId as PREMO_XCODE_SCHEME /
// PREMO_XCODE_BUNDLE_ID. PREMO_XCODE_QUIET carries `-quiet` by default so `dev`
// doesn't flood the terminal with build output (only warnings/errors show);
// `verbose` clears it.
export async function xcodeEnvFor(
  xcode: XcodeConfig | undefined,
  opts: {
    device?: string;
    platform?: string;
    interactive: boolean;
    verbose?: boolean;
    root?: string;
    // The active environment (DESIGN §15) — selects the scheme/bundleId. null/
    // absent ⇒ the project's default env (or the bare, env-agnostic pair).
    env?: string | null;
    // Persist the chosen destination as this project's last-run device (dev).
    remember?: boolean;
    // Re-prompt for the destination even if a last-used one is remembered (dev).
    pick?: boolean;
  },
): Promise<NodeJS.ProcessEnv> {
  if (!xcode) return {};
  // Resolve the env-varying facts first, so a per-env map that lacks the active
  // env fails before we boot a simulator (pickXcodeEnv throws).
  const facts = pickXcodeEnv(xcode, opts.env ?? null);
  const dest = await resolveDestination({
    xcode,
    flagDevice: opts.device,
    flagPlatform: opts.platform,
    interactive: opts.interactive && !opts.device && !opts.platform && !!process.stdin.isTTY,
    root: opts.root,
    pick: opts.pick,
  });
  if (opts.remember && opts.root) {
    await writeLastXcodeDest(opts.root, {
      dest: dest.dest,
      label: dest.label,
      bootUdid: dest.bootUdid,
      deviceUdid: dest.deviceUdid,
    });
  }
  const env: NodeJS.ProcessEnv = {
    PREMO_XCODE_DEST: dest.dest,
    PREMO_XCODE_SCHEME: facts.scheme,
    PREMO_XCODE_QUIET: opts.verbose ? "" : "-quiet",
  };
  if (dest.bootUdid) env.PREMO_XCODE_BOOT_UDID = dest.bootUdid;
  if (dest.deviceUdid) env.PREMO_XCODE_DEVICE_UDID = dest.deviceUdid;
  if (facts.bundleId) env.PREMO_XCODE_BUNDLE_ID = facts.bundleId;
  return env;
}

import type { ProjectManifest } from "../../manifest/types.js";
import { writeLastXcodeDest } from "../local.js";
import { resolveDestination } from "./destinations.js";

// The PREMO_XCODE_* env a verb run needs, or {} when this isn't an xcode
// project. Resolves the destination (flag → default → optional interactive pick)
// and exposes it (plus the bundle id) to the baked commands. PREMO_XCODE_QUIET
// carries `-quiet` by default so `dev` doesn't flood the terminal with build
// output (only warnings/errors show); `verbose` clears it. Returns the empty
// env for every other adapter, so the verb commands stay generic.
export async function xcodeEnvFor(
  manifest: ProjectManifest,
  opts: {
    device?: string;
    platform?: string;
    interactive: boolean;
    verbose?: boolean;
    root?: string;
    // Persist the chosen destination as this project's last-run device (dev).
    remember?: boolean;
    // Re-prompt for the destination even if a last-used one is remembered (dev).
    pick?: boolean;
  },
): Promise<NodeJS.ProcessEnv> {
  if (manifest.adapter !== "xcode" && !manifest.xcode) return {};
  const dest = await resolveDestination({
    manifest,
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
    PREMO_XCODE_QUIET: opts.verbose ? "" : "-quiet",
  };
  if (dest.bootUdid) env.PREMO_XCODE_BOOT_UDID = dest.bootUdid;
  if (dest.deviceUdid) env.PREMO_XCODE_DEVICE_UDID = dest.deviceUdid;
  if (manifest.xcode?.bundleId) env.PREMO_XCODE_BUNDLE_ID = manifest.xcode.bundleId;
  return env;
}

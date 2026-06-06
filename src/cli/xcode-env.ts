import type { Context } from "../core/context.js";
import { xcodeEnvFor } from "../core/xcode.js";
import { log } from "../core/logger.js";

export interface DestFlags {
  device?: string;
  platform?: string;
  verbose?: boolean;
}

// Resolve the PREMO_XCODE_* env for a verb run. A no-op (empty env) for
// non-xcode projects. `remember` persists the chosen destination as the
// project's last-run device (set by `dev`). On a resolution failure (e.g. no
// destination and no default) it logs the message and returns null to abort.
export async function resolveXcodeEnv(
  ctx: Context,
  flags: DestFlags,
  interactive: boolean,
  remember = false,
): Promise<NodeJS.ProcessEnv | null> {
  try {
    return await xcodeEnvFor(ctx.manifest, {
      device: flags.device,
      platform: flags.platform,
      verbose: flags.verbose,
      interactive,
      root: ctx.root,
      remember,
    });
  } catch (err) {
    log.error((err as Error).message);
    return null;
  }
}

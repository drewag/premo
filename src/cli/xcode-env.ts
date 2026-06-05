import type { Context } from "../core/context.js";
import { xcodeEnvFor } from "../core/xcode.js";
import { log } from "../core/logger.js";

export interface DestFlags {
  device?: string;
  platform?: string;
}

// Resolve the STRAND_XCODE_* env for a verb run. A no-op (empty env) for
// non-xcode projects. On a resolution failure (e.g. no destination and no
// default) it logs the message and returns null so the caller can abort.
export async function resolveXcodeEnv(
  ctx: Context,
  flags: DestFlags,
  interactive: boolean,
): Promise<NodeJS.ProcessEnv | null> {
  try {
    return await xcodeEnvFor(ctx.manifest, {
      device: flags.device,
      platform: flags.platform,
      interactive,
    });
  } catch (err) {
    log.error((err as Error).message);
    return null;
  }
}

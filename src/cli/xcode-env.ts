import type { Context } from "../core/context.js";
import type { XcodeConfig } from "../manifest/types.js";
import { xcodeEnvFor } from "../core/xcode.js";
import { resolvePackages } from "../core/packages.js";
import { log } from "../core/logger.js";

export interface DestFlags {
  device?: string;
  platform?: string;
  verbose?: boolean;
  pick?: boolean;
}

// The xcode config governing this run: a single-app repo's top-level block, or —
// in a monorepo — the named package/target's block (else the sole xcode package).
async function findXcodeConfig(ctx: Context, name?: string): Promise<XcodeConfig | undefined> {
  if (ctx.manifest.xcode) return ctx.manifest.xcode;
  const xcodePkgs = (await resolvePackages(ctx.root, ctx.manifest)).filter((p) => p.xcode);
  if (xcodePkgs.length === 0) return undefined;
  if (name) {
    const named = xcodePkgs.find((p) => p.name === name);
    if (named) return named.xcode;
  }
  return xcodePkgs.length === 1 ? xcodePkgs[0]!.xcode : undefined;
}

// Resolve the PREMO_XCODE_* env for a verb run. A no-op (empty env) for
// non-xcode projects. `name` is the verb's [target]/[package] argument, so the
// right native app is chosen in a polyglot monorepo. `remember` persists the
// chosen destination as the project's last-run device (set by `dev`). On a
// resolution failure (e.g. no destination and no default) it logs the message
// and returns null to abort.
export async function resolveXcodeEnv(
  ctx: Context,
  flags: DestFlags,
  interactive: boolean,
  remember = false,
  name?: string,
): Promise<NodeJS.ProcessEnv | null> {
  try {
    const xcode = await findXcodeConfig(ctx, name);
    return await xcodeEnvFor(xcode, {
      device: flags.device,
      platform: flags.platform,
      verbose: flags.verbose,
      pick: flags.pick,
      interactive,
      root: ctx.root,
      remember,
    });
  } catch (err) {
    log.error((err as Error).message);
    return null;
  }
}

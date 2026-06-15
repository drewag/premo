import type { Context } from "../core/context.js";
import type { XcodeConfig } from "../manifest/types.js";
import { resolveEnvName } from "../manifest/environments.js";
import { xcodeEnvFor } from "../core/xcode.js";
import { resolvePackages } from "../core/packages.js";
import { log } from "../core/logger.js";

export interface DestFlags {
  device?: string;
  platform?: string;
  verbose?: boolean;
  pick?: boolean;
  // The active environment (DESIGN §15) from `--env`; absent ⇒ the default env.
  env?: string;
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

// Resolve a verb run's environment: the PREMO_XCODE_* an xcode unit needs plus
// PREMO_ENV (the active environment, §15) for any project that declares one. A
// no-op (empty env) for a non-xcode project with no environments. `name` is the
// verb's [target]/[package] argument, so the right native app is chosen in a
// polyglot monorepo. `remember` persists the chosen destination as the project's
// last-run device (set by `dev`). On a resolution failure — an unknown `--env`,
// or no destination and no default — it logs the message and returns null to
// abort. The active env defaults to the project's default when `--env` is absent,
// so build/test (which take no `--env`) still pick the default-env scheme.
export async function resolveXcodeEnv(
  ctx: Context,
  flags: DestFlags,
  interactive: boolean,
  remember = false,
  name?: string,
): Promise<NodeJS.ProcessEnv | null> {
  try {
    const envName = resolveEnvName(ctx.manifest.environments, flags.env);
    const xcode = await findXcodeConfig(ctx, name);
    const env = await xcodeEnvFor(xcode, {
      device: flags.device,
      platform: flags.platform,
      verbose: flags.verbose,
      pick: flags.pick,
      env: envName,
      interactive,
      root: ctx.root,
      remember,
    });
    if (envName) env.PREMO_ENV = envName;
    return env;
  } catch (err) {
    log.error((err as Error).message);
    return null;
  }
}

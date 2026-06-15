// Environment-axis resolution (DESIGN §15). Pure helpers over the manifest's
// `environments` list and an xcode unit's per-env facts — no I/O, so they're
// shared by load/migrate, the runners, and the dev/deploy commands alike.
import type { Environment, XcodeConfig, XcodeEnv } from "./types.js";

// The env used when `--env` is omitted: the one flagged `default`, else the
// first declared, else null (a project with no `environments` block runs as a
// single implicit, unnamed env — today's behavior).
export function defaultEnvName(envs: Environment[]): string | null {
  return (envs.find((e) => e.default) ?? envs[0])?.name ?? null;
}

// Resolve the active env name from a `--env` flag against the declared set.
// Throws on an unknown name (so a typo'd `--env prdo` fails loudly rather than
// silently falling back). A null/absent flag yields the default env.
export function resolveEnvName(
  envs: Environment[],
  flag: string | null | undefined,
): string | null {
  if (flag == null) return defaultEnvName(envs);
  if (envs.length > 0 && !envs.some((e) => e.name === flag)) {
    const known = envs.map((e) => e.name).join(", ") || "(none)";
    throw new Error(`Unknown environment "${flag}". Declared environments: ${known}.`);
  }
  return flag;
}

// The deploy destinations (DESIGN §6.5 ref segmentation keys off this count):
// the envs flagged `deploy`. Empty ⇒ a single implicit deploy env (no `<env>`
// ref segment), which is the pre-§15 single-env behavior.
export function deployableEnvNames(envs: Environment[]): string[] {
  return envs.filter((e) => e.deploy).map((e) => e.name);
}

// The scheme/bundleId pair for an xcode unit under the active environment
// (DESIGN §15.4). A bare `scheme`/`bundleId` (no per-env map) is env-agnostic —
// the unit runs the same everywhere. A per-env map that lacks the active env is
// a real misconfiguration, so we error rather than guess a scheme.
export function pickXcodeEnv(xcode: XcodeConfig, envName: string | null): XcodeEnv {
  const map = xcode.environments;
  if (map && Object.keys(map).length > 0) {
    const hit = envName != null ? map[envName] : undefined;
    if (hit) return hit;
    const known = Object.keys(map).join(", ");
    throw new Error(
      `xcode unit defines no "${envName ?? "(default)"}" environment (has: ${known}).`,
    );
  }
  // Single-environment case: the bare pair, valid for any env.
  return { scheme: xcode.scheme!, bundleId: xcode.bundleId };
}

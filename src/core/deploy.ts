import { logRange, refExists } from "./git.js";
import { configEnv } from "./env.js";
import type { Target } from "./targets.js";

// Single env ⇒ `deployed/<target>`; multiple configured envs ⇒
// `deployed/<env>/<target>`. See DESIGN.md §6.5.
export function deployRef(target: string, env: string, multiEnv: boolean): string {
  return multiEnv ? `deployed/${env}/${target}` : `deployed/${target}`;
}

export interface DeployedRef {
  localBranch: string; // the branch premo advances and pushes
  trackingRef: string | null; // what to diff HEAD against (null ⇒ first deploy)
}

// Prefer the local branch, fall back to the origin tracking ref (so a fresh
// clone still knows what's deployed), else treat as a first deploy.
export async function resolveDeployedRef(
  root: string,
  target: string,
  env: string,
  multiEnv: boolean,
): Promise<DeployedRef> {
  const localBranch = deployRef(target, env, multiEnv);
  if (await refExists(root, localBranch)) return { localBranch, trackingRef: localBranch };
  const remote = `origin/${localBranch}`;
  if (await refExists(root, remote)) return { localBranch, trackingRef: remote };
  return { localBranch, trackingRef: null };
}

// A target's deploy state: where its release ref is and what's landed since.
export interface DeployPlan {
  target: Target;
  ref: DeployedRef;
  commits: { hash: string; subject: string }[];
  upToDate: boolean; // a prior release exists and nothing new touches the target
}

// Resolve which env to deploy to and whether the ref scheme is multi-env.
// `configured` is the deployable env set (empty ⇒ the implicit single "prod").
// Returns an error string instead of throwing so the CLI can print + exit 1.
export function resolveDeployEnv(
  configured: string[],
  requested: string | undefined,
): { env: string; multiEnv: boolean } | { error: string } {
  const envs = configured.length > 0 ? configured : ["prod"];
  const env = requested ?? envs[0]!;
  if (!envs.includes(env)) {
    return { error: `Unknown deploy env "${env}". Deployable: ${envs.join(", ")}` };
  }
  return { env, multiEnv: envs.length > 1 };
}

// Build the per-target deploy plan: resolve each target's release ref and the
// commits that have touched its member dirs since (DESIGN §13.5). Pure git reads.
export async function buildDeployPlans(
  root: string,
  deployable: Target[],
  env: string,
  multiEnv: boolean,
  memberDirs: (t: Target) => string[],
): Promise<DeployPlan[]> {
  const plans: DeployPlan[] = [];
  for (const target of deployable) {
    const ref = await resolveDeployedRef(root, target.name, env, multiEnv);
    const commits = ref.trackingRef
      ? await logRange(root, ref.trackingRef, "HEAD", memberDirs(target))
      : [];
    plans.push({ target, ref, commits, upToDate: !!ref.trackingRef && commits.length === 0 });
  }
  return plans;
}

// The pending set: targets with new commits, or — with `force` — every target.
// Drives both the `--yes` path and the interactive picker's preselection.
export function pendingPlans(plans: DeployPlan[], force: boolean): DeployPlan[] {
  return plans.filter((p) => force || !p.upToDate);
}

export function pendingLabel(p: DeployPlan): string {
  if (!p.ref.trackingRef) return "first deploy";
  if (p.commits.length === 0) return "up to date";
  return `${p.commits.length} new commit${p.commits.length === 1 ? "" : "s"}`;
}

// The env a deploy command runs under: the same envFile < project-`env` gap-fill
// layering every other verb uses (configEnv — a real exported shell var wins),
// plus premo's injected PREMO_DEPLOY_* / PREMO_ENV facts on top. execa extends
// process.env underneath, so this is exactly the run.ts contract for `deploy`.
export function deployEnvVars(
  fileVars: Record<string, string>,
  projectEnv: Record<string, string> | undefined,
  facts: { version: string; target: string; env: string },
): NodeJS.ProcessEnv {
  return {
    ...configEnv(fileVars, projectEnv, undefined),
    PREMO_DEPLOY_VERSION: facts.version,
    PREMO_DEPLOY_TARGET: facts.target,
    PREMO_DEPLOY_ENV: facts.env,
    PREMO_ENV: facts.env,
  };
}

import { refExists } from "./git.js";

// Single env ⇒ `deployed/<target>`; multiple configured envs ⇒
// `deployed/<env>/<target>`. See DESIGN.md §6.5.
export function deployRef(target: string, env: string, multiEnv: boolean): string {
  return multiEnv ? `deployed/${env}/${target}` : `deployed/${target}`;
}

export interface DeployedRef {
  localBranch: string; // the branch strand advances and pushes
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

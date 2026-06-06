import { Command } from "commander";
import { execa } from "execa";
import readline from "node:readline/promises";
import pc from "picocolors";
import { ensureContext } from "../../core/context.js";
import { resolveTargets, type Target } from "../../core/targets.js";
import { nextVersion } from "../../core/version.js";
import { resolveDeployedRef, type DeployedRef } from "../../core/deploy.js";
import {
  advanceBranchRef,
  createTag,
  currentBranch,
  fetchOrigin,
  headCommit,
  isAncestor,
  isDirty,
  logRange,
  pushRefs,
} from "../../core/git.js";
import { log } from "../../core/logger.js";

interface Plan {
  target: Target;
  ref: DeployedRef;
  commits: { hash: string; subject: string }[];
  upToDate: boolean;
}

export function register(program: Command): void {
  program
    .command("deploy")
    .description("Deploy targets, tracking releases through git tags.")
    .argument("[target]", "deploy a single target")
    .option("--force", "deploy even if there are no new commits")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--env <env>", "environment to deploy to")
    .action(
      async (
        targetArg: string | undefined,
        opts: { force?: boolean; yes?: boolean; env?: string },
      ) => {
        const ctx = await ensureContext(process.cwd());
        const targets = await resolveTargets(ctx.root, ctx.manifest);

        let deployable = targets.filter((t) => t.commands.deploy);
        if (targetArg) {
          const t = targets.find((x) => x.name === targetArg);
          if (!t) {
            log.error(
              `No target "${targetArg}". Known: ${targets.map((x) => x.name).join(", ") || "none"}`,
            );
            process.exitCode = 1;
            return;
          }
          if (!t.commands.deploy) {
            log.error(
              `Target "${targetArg}" has no deploy command (set commands.deploy in premo.json).`,
            );
            process.exitCode = 1;
            return;
          }
          deployable = [t];
        }
        if (deployable.length === 0) {
          log.warn("No deploy command configured for this project.");
          log.dim('  set "commands.deploy" (or targets.<name>.commands.deploy) in premo.json.');
          process.exitCode = 1;
          return;
        }

        const envs = ctx.manifest.deploy?.envs ?? ["prod"];
        const env = opts.env ?? envs[0]!;
        if (!envs.includes(env)) {
          log.error(`Unknown env "${env}". Configured: ${envs.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        const multiEnv = envs.length > 1;

        const head = await headCommit(ctx.root);
        if (!head) {
          log.error("Not a git repository (or no commits yet).");
          process.exitCode = 1;
          return;
        }
        const branch = await currentBranch(ctx.root);

        log.step("Fetching tags + deploy refs from origin");
        await fetchOrigin(ctx.root);

        const plans: Plan[] = [];
        for (const target of deployable) {
          const ref = await resolveDeployedRef(ctx.root, target.name, env, multiEnv);
          const commits = ref.trackingRef ? await logRange(ctx.root, ref.trackingRef) : [];
          plans.push({ target, ref, commits, upToDate: !!ref.trackingRef && commits.length === 0 });
        }

        const toDeploy = plans.filter((p) => opts.force || !p.upToDate);
        if (toDeploy.length === 0) {
          log.ok(`Already up to date — nothing to deploy. Use --force to redeploy.`);
          return;
        }

        const version = await nextVersion(ctx.root);

        log.info("");
        log.info(
          `${pc.bold(`Deploy ${version}`)}  ${pc.dim(`(env ${env}, ${branch} @ ${head.slice(0, 7)})`)}`,
        );
        for (const p of toDeploy) {
          log.info(`  ${pc.cyan(p.target.name)} → release/${p.target.name}/${version}`);
          if (!p.ref.trackingRef) log.dim("    first deploy (no prior release)");
          else if (p.commits.length === 0) log.dim("    no new commits (forced)");
          else for (const c of p.commits) log.dim(`    ${c.hash}  ${c.subject}`);
        }
        log.info("");

        if (await isDirty(ctx.root)) {
          log.warn("Working tree is dirty — the build will include uncommitted changes,");
          log.warn(`but the release tag will point at the committed HEAD (${head.slice(0, 7)}).`);
        }

        if (!opts.yes && !(await confirm(`Deploy ${toDeploy.length} target(s) as ${version}?`))) {
          log.info("Aborted.");
          return;
        }

        let failed = false;
        for (const p of toDeploy) {
          if (p.ref.trackingRef && !(await isAncestor(ctx.root, p.ref.trackingRef, "HEAD"))) {
            log.error(
              `${p.target.name}: ${p.ref.localBranch} is ahead of HEAD (not a fast-forward); skipping.`,
            );
            failed = true;
            continue;
          }

          log.step(`Deploying ${p.target.name}: ${p.target.commands.deploy}`);
          const res = await execa(p.target.commands.deploy!, {
            cwd: p.target.cwd,
            shell: true,
            stdio: "inherit",
            reject: false,
            env: {
              ...process.env,
              PREMO_DEPLOY_VERSION: version,
              PREMO_DEPLOY_TARGET: p.target.name,
              PREMO_DEPLOY_ENV: env,
            },
          });
          if (res.exitCode !== 0) {
            log.error(
              `${p.target.name} deploy failed (exit ${res.exitCode}); release not recorded.`,
            );
            failed = true;
            continue;
          }

          const tag = `release/${p.target.name}/${version}`;
          await advanceBranchRef(ctx.root, p.ref.localBranch, head);
          await createTag(ctx.root, tag, head);
          const pushed = await pushRefs(ctx.root, [p.ref.localBranch, tag]);
          log.ok(
            `${p.target.name} deployed — ${tag}${pushed ? " (pushed)" : pc.yellow(" (push failed; recorded locally)")}`,
          );
        }

        log.info("");
        if (failed) {
          log.error(`Deploy finished with failures (version ${version}).`);
          process.exitCode = 1;
        } else {
          log.ok(`Deploy complete (version ${version}).`);
        }
      },
    );
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

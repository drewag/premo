import { Command } from "commander";
import { execa } from "execa";
import pc from "picocolors";
import { ensureContext } from "../../core/context.js";
import { resolveTargets, type Target } from "../../core/targets.js";
import { resolvePackages } from "../../core/packages.js";
import { deployableEnvNames } from "../../manifest/environments.js";
import { envFileVars } from "../../core/env.js";
import { multiSelectFromList } from "../../core/select.js";
import { nextVersion } from "../../core/version.js";
import {
  buildDeployPlans,
  deployEnvVars,
  pendingLabel,
  pendingPlans,
  resolveDeployEnv,
  type DeployPlan,
} from "../../core/deploy.js";
import {
  advanceBranchRef,
  createTag,
  currentBranch,
  fetchOrigin,
  headCommit,
  isAncestor,
  isDirty,
  pushRefs,
} from "../../core/git.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("deploy")
    .description("Deploy targets, tracking releases through git tags.")
    .argument("[target]", "deploy a single target")
    .option("--force", "deploy even if there are no new commits")
    .option("-y, --yes", "deploy the pending set without the interactive picker")
    .option("--env <env>", "environment to deploy to")
    .action(
      async (
        targetArg: string | undefined,
        opts: { force?: boolean; yes?: boolean; env?: string },
      ) => {
        const ctx = await ensureContext(process.cwd());
        const targets = await resolveTargets(ctx.root, ctx.manifest);
        const packages = await resolvePackages(ctx.root, ctx.manifest);
        const dirsByName = new Map(packages.map((p) => [p.name, p.dirs]));
        const memberDirs = (t: Target) => t.packages.flatMap((n) => dirsByName.get(n) ?? []);

        let deployable = targets.filter((t) => t.deploy);
        if (targetArg) {
          const t = targets.find((x) => x.name === targetArg);
          if (!t) {
            log.error(
              `No target "${targetArg}". Known: ${targets.map((x) => x.name).join(", ") || "none"}`,
            );
            process.exitCode = 1;
            return;
          }
          if (!t.deploy) {
            log.error(`Target "${targetArg}" has no deploy command (set it in premo.json).`);
            process.exitCode = 1;
            return;
          }
          deployable = [t];
        }
        if (deployable.length === 0) {
          log.warn("No deployable target in this project.");
          log.dim("  add a `deploy:<target>` script, or a target's `deploy` in premo.json.");
          process.exitCode = 1;
          return;
        }

        // Deploy destinations are the `deploy: true` entries of the environments
        // axis (DESIGN §15.2); with none declared, a single implicit "prod" env
        // preserves the pre-§15 default. The `<env>` ref segment (§6.5) appears
        // only when more than one is deployable.
        const resolved = resolveDeployEnv(deployableEnvNames(ctx.manifest.environments), opts.env);
        if ("error" in resolved) {
          log.error(resolved.error);
          process.exitCode = 1;
          return;
        }
        const { env, multiEnv } = resolved;

        // `.env` < `.env.<env>` overlay, gap-filled — the same env the verbs run
        // under (DESIGN §15), so a deploy command sees the destination's config.
        const fileVars = await envFileVars(ctx.root, ctx.manifest.envFile ?? undefined, env);

        const head = await headCommit(ctx.root);
        if (!head) {
          log.error("Not a git repository (or no commits yet).");
          process.exitCode = 1;
          return;
        }
        const branch = await currentBranch(ctx.root);

        log.step("Fetching tags + deploy refs from origin");
        await fetchOrigin(ctx.root);

        const plans = await buildDeployPlans(ctx.root, deployable, env, multiEnv, memberDirs);

        const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;

        // Select what to deploy: a named target ships directly; bare deploy
        // offers an interactive multi-select pre-checked to the pending set
        // (or, with --yes/no-TTY, deploys the pending set non-interactively).
        let toDeploy: DeployPlan[];
        if (targetArg) {
          toDeploy = plans;
        } else if (opts.yes) {
          toDeploy = pendingPlans(plans, !!opts.force);
        } else if (interactive) {
          const pre = plans.map((p) => !!opts.force || !p.upToDate);
          const labels = plans.map((p) => `${p.target.name}  ${pc.dim(`(${pendingLabel(p)})`)}`);
          const chosen = await multiSelectFromList(labels, {
            header: "Select targets to deploy — space toggles, a all, enter confirms:",
            preselected: pre,
          });
          if (chosen === null) {
            log.info("Aborted.");
            return;
          }
          toDeploy = chosen.map((i) => plans[i]!);
        } else {
          log.error("No TTY to confirm the deploy — re-run with --yes (deploys the pending set).");
          process.exitCode = 1;
          return;
        }

        if (toDeploy.length === 0) {
          log.ok("Nothing to deploy. (Pending targets were all deselected, or none are pending.)");
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
          else if (p.commits.length === 0) log.dim("    no new commits");
          else for (const c of p.commits) log.dim(`    ${c.hash}  ${c.subject}`);
        }
        log.info("");

        if (await isDirty(ctx.root)) {
          log.warn("Working tree is dirty — the build will include uncommitted changes,");
          log.warn(`but the release tag will point at the committed HEAD (${head.slice(0, 7)}).`);
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

          log.step(`Deploying ${p.target.name}: ${p.target.deploy}`);
          const res = await execa(p.target.deploy!, {
            cwd: p.target.deployCwd,
            shell: true,
            stdio: "inherit",
            reject: false,
            env: deployEnvVars(fileVars, ctx.manifest.env, {
              version,
              target: p.target.name,
              env,
            }),
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

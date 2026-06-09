import { Command } from "commander";
import { execa } from "execa";
import pc from "picocolors";
import { ensureContext } from "../../core/context.js";
import { resolveTargets, type Target } from "../../core/targets.js";
import { resolvePackages } from "../../core/packages.js";
import { envFileVars } from "../../core/env.js";
import { multiSelectFromList } from "../../core/select.js";
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

function pendingLabel(p: Plan): string {
  if (!p.ref.trackingRef) return "first deploy";
  if (p.commits.length === 0) return "up to date";
  return `${p.commits.length} new commit${p.commits.length === 1 ? "" : "s"}`;
}

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
        const fileVars = await envFileVars(ctx.root, ctx.manifest.envFile ?? undefined);
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

        // A target is "pending" when commits touching its member packages have
        // landed since its last release (DESIGN §13.5).
        const plans: Plan[] = [];
        for (const target of deployable) {
          const ref = await resolveDeployedRef(ctx.root, target.name, env, multiEnv);
          const commits = ref.trackingRef
            ? await logRange(ctx.root, ref.trackingRef, "HEAD", memberDirs(target))
            : [];
          plans.push({ target, ref, commits, upToDate: !!ref.trackingRef && commits.length === 0 });
        }

        const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;

        // Select what to deploy: a named target ships directly; bare deploy
        // offers an interactive multi-select pre-checked to the pending set
        // (or, with --yes/no-TTY, deploys the pending set non-interactively).
        let toDeploy: Plan[];
        if (targetArg) {
          toDeploy = plans;
        } else if (opts.yes) {
          toDeploy = plans.filter((p) => opts.force || !p.upToDate);
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
            env: {
              ...process.env,
              ...fileVars,
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

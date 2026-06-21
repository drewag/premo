import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nextVersionFromTags, todayStamp } from "../../src/core/version.js";
import {
  buildDeployPlans,
  deployEnvVars,
  deployRef,
  pendingLabel,
  pendingPlans,
  resolveDeployEnv,
  resolveDeployedRef,
  type DeployPlan,
} from "../../src/core/deploy.js";
import type { Target } from "../../src/core/targets.js";

// A minimal Target stub — the deploy planners only read `.name`/`.packages`.
function target(name: string, packages: string[] = []): Target {
  return {
    name,
    packages,
    dev: [],
    deploy: `ship-${name}`,
    deployCwd: ".",
    isDefault: false,
  };
}

function plan(over: Partial<DeployPlan> & { name: string }): DeployPlan {
  const { name, ...rest } = over;
  return {
    target: target(name),
    ref: { localBranch: `deployed/${name}`, trackingRef: `deployed/${name}` },
    commits: [],
    upToDate: false,
    ...rest,
  };
}

describe("nextVersionFromTags", () => {
  const today = "2026.06.04";

  it("starts at .1 when there are no tags for today", () => {
    expect(nextVersionFromTags([], today)).toBe("2026.06.04.1");
  });

  it("increments past the highest counter across all targets today", () => {
    const tags = [
      "release/drewag-me/2026.06.04.1",
      "release/drewag-me/2026.06.04.3",
      "release/other/2026.06.04.2",
    ];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.4");
  });

  it("ignores tags from other days", () => {
    const tags = ["release/drewag-me/2026.06.03.9", "release/drewag-me/2026.05.01.5"];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.1");
  });

  it("ignores malformed tags", () => {
    const tags = ["release/x/not-a-version", "weird", "release/x/2026.06.04.2"];
    expect(nextVersionFromTags(tags, today)).toBe("2026.06.04.3");
  });

  it("todayStamp formats as YYYY.MM.DD", () => {
    expect(todayStamp(new Date("2026-06-04T12:00:00"))).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });
});

describe("deployRef", () => {
  it("omits the env segment for a single env", () => {
    expect(deployRef("drewag-me", "prod", false)).toBe("deployed/drewag-me");
  });

  it("includes the env segment when multiple envs are configured", () => {
    expect(deployRef("drewag-me", "staging", true)).toBe("deployed/staging/drewag-me");
  });
});

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "premo-deployref-"));
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "x"), "1");
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("resolveDeployedRef", () => {
  it("reports a first deploy (no tracking ref) when nothing is deployed yet", async () => {
    const dir = await initRepo();
    const ref = await resolveDeployedRef(dir, "web", "prod", false);
    expect(ref.localBranch).toBe("deployed/web");
    expect(ref.trackingRef).toBeNull();
  });

  it("tracks the local deploy branch once it exists", async () => {
    const dir = await initRepo();
    const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await execa("git", ["update-ref", "refs/heads/deployed/web", head], { cwd: dir });
    const ref = await resolveDeployedRef(dir, "web", "prod", false);
    expect(ref.trackingRef).toBe("deployed/web");
  });
});

describe("resolveDeployEnv", () => {
  it("defaults to an implicit prod when no envs are configured", () => {
    expect(resolveDeployEnv([], undefined)).toEqual({ env: "prod", multiEnv: false });
  });

  it("picks the first configured env and stays single-env", () => {
    expect(resolveDeployEnv(["prod"], undefined)).toEqual({ env: "prod", multiEnv: false });
  });

  it("honors --env and marks multiEnv when more than one is deployable", () => {
    expect(resolveDeployEnv(["prod", "staging"], "staging")).toEqual({
      env: "staging",
      multiEnv: true,
    });
  });

  it("rejects an unknown env", () => {
    const r = resolveDeployEnv(["prod", "staging"], "nope");
    expect(r).toEqual({ error: 'Unknown deploy env "nope". Deployable: prod, staging' });
  });
});

describe("pendingPlans / pendingLabel", () => {
  it("selects only targets that are not up to date", () => {
    const plans = [plan({ name: "a", upToDate: true }), plan({ name: "b", upToDate: false })];
    expect(pendingPlans(plans, false).map((p) => p.target.name)).toEqual(["b"]);
  });

  it("selects every target with --force", () => {
    const plans = [plan({ name: "a", upToDate: true }), plan({ name: "b", upToDate: true })];
    expect(pendingPlans(plans, true).map((p) => p.target.name)).toEqual(["a", "b"]);
  });

  it("labels first deploy, up to date, and pluralized commit counts", () => {
    expect(pendingLabel(plan({ name: "a", ref: { localBranch: "x", trackingRef: null } }))).toBe(
      "first deploy",
    );
    expect(pendingLabel(plan({ name: "a", commits: [], upToDate: true }))).toBe("up to date");
    expect(pendingLabel(plan({ name: "a", commits: [{ hash: "abc", subject: "x" }] }))).toBe(
      "1 new commit",
    );
    expect(
      pendingLabel(
        plan({
          name: "a",
          commits: [
            { hash: "abc", subject: "x" },
            { hash: "def", subject: "y" },
          ],
        }),
      ),
    ).toBe("2 new commits");
  });
});

describe("deployEnvVars", () => {
  it("injects the PREMO_DEPLOY_* facts and PREMO_ENV", () => {
    const env = deployEnvVars({}, undefined, {
      version: "2026.06.04.1",
      target: "web",
      env: "prod",
    });
    expect(env.PREMO_DEPLOY_VERSION).toBe("2026.06.04.1");
    expect(env.PREMO_DEPLOY_TARGET).toBe("web");
    expect(env.PREMO_DEPLOY_ENV).toBe("prod");
    expect(env.PREMO_ENV).toBe("prod");
  });

  it("passes pre-gap-filled env-file vars through and layers project env on top", () => {
    // fileVars arrive already gap-filled from envFileVars (its own test covers
    // the real-shell-var-wins rule); deployEnvVars just layers + injects.
    const env = deployEnvVars(
      { A: "file", ONLY_FILE: "ok" },
      { A: "project", B: "project" },
      {
        version: "v",
        target: "t",
        env: "prod",
      },
    );
    expect(env.A).toBe("project"); // project env overrides the file
    expect(env.B).toBe("project");
    expect(env.ONLY_FILE).toBe("ok");
  });

  it("gap-fills the inline project env so a real exported var still wins", () => {
    const prev = process.env.DEPLOY_TEST_VAR;
    process.env.DEPLOY_TEST_VAR = "from-shell";
    try {
      const env = deployEnvVars(
        {},
        { DEPLOY_TEST_VAR: "from-project" },
        {
          version: "v",
          target: "t",
          env: "prod",
        },
      );
      // the inline project value does NOT override the exported shell var
      expect(env.DEPLOY_TEST_VAR).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.DEPLOY_TEST_VAR;
      else process.env.DEPLOY_TEST_VAR = prev;
    }
  });
});

describe("buildDeployPlans", () => {
  it("marks a first deploy and counts commits touching member dirs", async () => {
    const dir = await initRepo();
    const t = target("web", ["web"]);

    // first deploy: no tracking ref, no commits
    let plans = await buildDeployPlans(dir, [t], "prod", false, () => ["."]);
    expect(plans[0]!.ref.trackingRef).toBeNull();
    expect(plans[0]!.upToDate).toBe(false);

    // record a release at HEAD, then land a new commit under the member dir
    const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await execa("git", ["update-ref", "refs/heads/deployed/web", head], { cwd: dir });
    await writeFile(path.join(dir, "y"), "2");
    await execa("git", ["add", "-A"], { cwd: dir });
    await execa("git", ["commit", "-m", "feat"], { cwd: dir });

    plans = await buildDeployPlans(dir, [t], "prod", false, () => ["."]);
    expect(plans[0]!.ref.trackingRef).toBe("deployed/web");
    expect(plans[0]!.commits.length).toBe(1);
    expect(plans[0]!.upToDate).toBe(false);
  });
});

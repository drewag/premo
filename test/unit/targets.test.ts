import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveTargets, defaultTarget, toTargetConfig } from "../../src/core/targets.js";
import { ProjectManifest, type ProjectManifestInput } from "../../src/manifest/types.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-targets2-"));
}
async function pkg(dir: string, contents: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents));
}
const M = (extra: Partial<ProjectManifestInput> = {}) =>
  ProjectManifest.parse({ name: "demo", ...extra });

// A manual monorepo with two members (so the monorepo adapter fires).
async function mono(root: string, rootExtra: object = {}): Promise<void> {
  await pkg(root, { name: "mono", bin: "./x", ...rootExtra });
}

describe("resolveTargets — auto-seed (DESIGN §13.3)", () => {
  it("seeds a 1:1 target from a package with a dev script", async () => {
    const root = await tmp();
    await mono(root);
    await pkg(path.join(root, "api"), { name: "api", scripts: { dev: "node .", build: "tsc" } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    const targets = await resolveTargets(root, M());
    const api = targets.find((t) => t.name === "api")!;
    expect(api.packages).toEqual(["api"]);
    expect(api.dev.map((d) => d.command)).toEqual(["yarn dev"]);
    expect(api.dev[0]!.cwd).toBe(path.join(root, "api"));
  });

  it("auto-detects deploy from a root `deploy:<name>` convention script", async () => {
    const root = await tmp();
    await mono(root, { scripts: { "deploy:api": "do-it" } });
    await pkg(path.join(root, "api"), { name: "api", scripts: { dev: "node ." } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    const targets = await resolveTargets(root, M());
    expect(targets.find((t) => t.name === "api")!.deploy).toBe("yarn deploy:api");
    expect(targets.find((t) => t.name === "api")!.deployCwd).toBe(root);
    expect(targets.find((t) => t.name === "web")!.deploy).toBeNull();
  });

  it("auto-detects deploy from a package's own deploy script, run in the package", async () => {
    const root = await tmp();
    await mono(root);
    await pkg(path.join(root, "api"), { name: "api", scripts: { deploy: "ship" } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    const api = (await resolveTargets(root, M())).find((t) => t.name === "api")!;
    expect(api.deploy).toBe("yarn deploy");
    expect(api.deployCwd).toBe(path.join(root, "api"));
  });

  it("does not seed a package that can neither run nor deploy", async () => {
    const root = await tmp();
    await mono(root);
    await pkg(path.join(root, "lib"), { name: "lib", scripts: { build: "tsc", test: "jest" } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    expect((await resolveTargets(root, M())).map((t) => t.name)).toEqual(["web"]);
  });
});

describe("resolveTargets — configured targets (DESIGN §13.4)", () => {
  it("expands a compose target to `docker compose up` and honors default", async () => {
    const root = await tmp();
    const targets = await resolveTargets(
      root,
      M({ targets: [{ name: "stack", compose: "docker-compose.yml", default: true }] }),
    );
    expect(targets.find((t) => t.name === "stack")!.dev).toEqual([
      {
        label: "stack",
        command: "docker compose -f docker-compose.yml up",
        cwd: root,
        kind: "service",
      },
    ]);
    expect(defaultTarget(targets)?.name).toBe("stack");
  });

  it("uses a leaf command target verbatim", async () => {
    const root = await tmp();
    const targets = await resolveTargets(
      root,
      M({ targets: [{ name: "app", command: "make run" }] }),
    );
    expect(targets[0]!.dev[0]!.command).toBe("make run");
  });

  it("lets a configured target override a seeded one's deploy", async () => {
    const root = await tmp();
    await mono(root, { scripts: { "deploy:api": "auto" } });
    await pkg(path.join(root, "api"), { name: "api", scripts: { dev: "node ." } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    const targets = await resolveTargets(root, M({ targets: [{ name: "api", deploy: "custom" }] }));
    expect(targets.find((t) => t.name === "api")!.deploy).toBe("custom");
  });

  it("runs each member's dev for a multi-package composite", async () => {
    const root = await tmp();
    await mono(root);
    await pkg(path.join(root, "api"), { name: "api", scripts: { dev: "node ." } });
    await pkg(path.join(root, "web"), { name: "web", scripts: { dev: "vite" } });

    const all = (
      await resolveTargets(root, M({ targets: [{ name: "all", packages: ["api", "web"] }] }))
    ).find((t) => t.name === "all")!;
    expect(all.dev.map((d) => d.label).sort()).toEqual(["api", "web"]);
  });
});

describe("defaultTarget / toTargetConfig", () => {
  it("returns the sole target, else null when ambiguous", async () => {
    const root = await tmp();
    const one = await resolveTargets(root, M({ targets: [{ name: "only", command: "x" }] }));
    expect(defaultTarget(one)?.name).toBe("only");
    const two = await resolveTargets(
      root,
      M({
        targets: [
          { name: "a", command: "x" },
          { name: "b", command: "y" },
        ],
      }),
    );
    expect(defaultTarget(two)).toBeNull();
  });

  it("persists only non-derived fields (dev is never stored)", async () => {
    const root = await tmp();
    const t = (
      await resolveTargets(
        root,
        M({
          targets: [
            {
              name: "frontend",
              packages: ["frontend"],
              deploy: "yarn deploy:frontend",
              default: true,
            },
          ],
        }),
      )
    )[0]!;
    expect(toTargetConfig(t)).toEqual({
      name: "frontend",
      packages: ["frontend"],
      deploy: "yarn deploy:frontend",
      default: true,
    });
  });
});

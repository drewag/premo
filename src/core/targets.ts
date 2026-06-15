import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifest, ProjectManifestInput } from "../manifest/types.js";
import { resolvePackages, type Package } from "./packages.js";
import { detectPackageManager, readPackageJson } from "./adapters/node-shared.js";

// One process `dev` brings up for a target. A target expands to one process
// (compose / command) or several (a compose substrate plus one per member
// package with a dev script). `port` is the member's own port (so several dev
// servers under one target don't collide); absent for compose/CLI procs.
export interface DevProc {
  label: string;
  command: string;
  cwd: string;
  kind: "service" | "command";
  port?: number;
}

// A fully-resolved run/deploy target (DESIGN §13.3). `dev` is the derived list
// of processes to spawn; `deploy` is the ship command (run in `deployCwd`).
export interface Target {
  name: string;
  packages: string[]; // member package names (drive affected / pending-deploy)
  dev: DevProc[];
  deploy: string | null;
  deployCwd: string;
  ports?: { base: number; block?: number };
  isDefault: boolean;
}

// Spacing between adjacent serving targets' base ports within the project block.
export const PORT_STEP = 10;

function composeUp(file: string): string {
  return `docker compose -f ${file} up`;
}

// Resolve the run/deploy targets: auto-seed 1:1 from runnable/deployable
// packages, then apply configured targets (overrides + composites like a compose
// stack). See DESIGN.md §13.3–§13.5.
export async function resolveTargets(root: string, manifest: ProjectManifest): Promise<Target[]> {
  const packages = await resolvePackages(root, manifest);
  const pkgByName = new Map(packages.map((p) => [p.name, p]));
  const rootScripts = (await readPackageJson(root))?.scripts ?? {};
  const pm = detectPackageManager(root);
  const pmRun = (s: string) => (pm === "npm" ? `npm run ${s}` : `${pm} ${s}`);

  // A member package's own port comes from its same-named target's config block,
  // so several dev servers under one composite target each bind a distinct port.
  const portByName = new Map(
    manifest.targets.filter((t) => t.ports).map((t) => [t.name, t.ports!.base] as const),
  );
  const memberProcs = (members: string[]): DevProc[] =>
    members
      .map((n) => pkgByName.get(n))
      .filter((p): p is Package => !!p && !!p.commands.dev)
      .map((p) => {
        const port = portByName.get(p.name);
        return {
          label: p.name,
          command: p.commands.dev!,
          cwd: p.cwd,
          kind: p.kind,
          ...(port !== undefined ? { port } : {}),
        };
      });

  const byName = new Map<string, Target>();

  // 1. Auto-seed a 1:1 target for every package that can run or deploy. Deploy
  // resolves from the package's own `deploy` script, else a root `deploy:<name>`
  // convention script (odo's central orchestration).
  for (const p of packages) {
    const procs = memberProcs([p.name]);
    let deploy: string | null = null;
    let deployCwd = root;
    if (p.commands.deploy) {
      deploy = p.commands.deploy;
      deployCwd = p.cwd;
    } else if (rootScripts[`deploy:${p.name}`]) {
      deploy = pmRun(`deploy:${p.name}`);
      deployCwd = root;
    }
    if (procs.length === 0 && !deploy) continue; // nothing to run or ship → not a target
    byName.set(p.name, {
      name: p.name,
      packages: [p.name],
      dev: procs,
      deploy,
      deployCwd,
      isDefault: false,
    });
  }

  // 2. Apply configured targets — override a seeded one or add a composite.
  for (const cfg of manifest.targets) {
    const existing = byName.get(cfg.name);
    const members = cfg.packages.length
      ? cfg.packages
      : (existing?.packages ?? (pkgByName.has(cfg.name) ? [cfg.name] : []));

    let dev: DevProc[];
    if (cfg.compose) {
      // A compose target brings up the substrate AND any member packages' dev
      // servers (the "infra in compose, apps on host" pattern, DESIGN §13.3).
      const composeProc: DevProc = {
        label: cfg.name,
        command: composeUp(cfg.compose),
        cwd: root,
        kind: "service",
      };
      dev = [composeProc, ...memberProcs(members)];
    } else if (cfg.command) {
      dev = [{ label: cfg.name, command: cfg.command, cwd: root, kind: "service" }];
    } else {
      dev = memberProcs(members);
    }

    byName.set(cfg.name, {
      name: cfg.name,
      packages: members,
      dev,
      deploy: cfg.deploy ?? existing?.deploy ?? null,
      deployCwd: cfg.deploy ? root : (existing?.deployCwd ?? root),
      ports: cfg.ports ?? existing?.ports,
      isDefault: cfg.default ?? false,
    });
  }

  // 3. Convention: a repo-level deploy script (`deploy/deploy.sh`) ships the whole
  // project. Wire it as the deploy command for the default (or sole) target when
  // nothing more specific resolved — the manual pattern cyclingjourneys/drewag.me
  // already use, now picked up automatically (and baked at adopt like deploy:<name>).
  if (existsSync(path.join(root, "deploy", "deploy.sh"))) {
    const all = [...byName.values()];
    const target = all.find((t) => t.isDefault) ?? (all.length === 1 ? all[0] : undefined);
    if (target && !target.deploy) {
      target.deploy = "./deploy/deploy.sh";
      target.deployCwd = root;
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The target bare `premo dev` brings up: an explicit `default`, or the sole
// target when there's exactly one. Null ⇒ caller must ask which.
export function defaultTarget(targets: Target[]): Target | null {
  return targets.find((t) => t.isDefault) ?? (targets.length === 1 ? targets[0]! : null);
}

// Whether a target binds an HTTP port in dev (and so earns its own port): a
// non-compose service whose members aren't native (xcode) apps. A compose-backed
// target owns its ports via the compose file (and its member dev servers carry
// their own ports); xcode/CLI targets don't serve.
export function servesHttp(t: Target, xcodePackages: Set<string>): boolean {
  if (t.packages.some((n) => xcodePackages.has(n))) return false;
  if (t.dev.some((d) => d.command.startsWith("docker compose"))) return false;
  return t.dev.some((d) => d.kind === "service");
}

// Port range (in ports) the serving targets need — callers size the project
// block to fit before assigning.
export function portsNeeded(targets: Target[], xcodePackages: Set<string>): number {
  return targets.filter((t) => servesHttp(t, xcodePackages)).length * PORT_STEP;
}

// Give each serving target a distinct base port within the project block, so
// concurrent `premo dev` servers don't collide (DESIGN §13.4). Mutates in place.
export function assignTargetPorts(
  targets: Target[],
  base: number,
  xcodePackages: Set<string>,
): void {
  let offset = 0;
  for (const t of targets) {
    if (!servesHttp(t, xcodePackages)) continue;
    t.ports = { base: base + offset };
    offset += PORT_STEP;
  }
}

// The serializable form `premo adopt` materializes into premo.json. dev is
// derived (from compose/command/packages) so it's never stored; we persist only
// what isn't recomputed: membership, a resolved deploy command, ports, default.
export function toTargetConfig(t: Target): NonNullable<ProjectManifestInput["targets"]>[number] {
  return {
    name: t.name,
    packages: t.packages,
    ...(t.deploy ? { deploy: t.deploy } : {}),
    ...(t.ports ? { ports: t.ports } : {}),
    ...(t.isDefault ? { default: true } : {}),
  };
}

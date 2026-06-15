import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifestInput, Verb, XcodeConfig, XcodeEnv } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { log } from "../logger.js";
import {
  buildSettings,
  findXcodeProject,
  listSchemes,
  pickDefaultDestination,
  projectFlag,
  xcodeCommands,
} from "../xcode.js";
import { type Adapter, type DetectedPackage } from "./index.js";

// Native Apple project (.xcodeproj / .xcworkspace). One target per project;
// `premo test` runs the whole scheme (unit + UI suites). The scheme, bundle id,
// and a default simulator are resolved once at adopt time and baked into
// premo.json, so the verbs never shell out to `xcodebuild -list` on every run.
export const xcodeAdapter: Adapter = {
  name: "xcode",

  async detect(root: string): Promise<boolean> {
    return (await findXcodeProject(root)) !== null;
  },

  async packages(root: string): Promise<DetectedPackage[]> {
    const proj = await findXcodeProject(root);
    if (!proj) return [];
    // A best-effort xcode block so destination resolution engages even before
    // `adopt` bakes the richer one: project/workspace path (relative to this
    // unit) + the scheme guessed as the project basename — the same guess the
    // live `command()` makes. bundleId/defaultDestination stay unset; `dev`
    // resolves the bundle id from build settings and prompts (or takes --device)
    // for a destination. `adopt` later fills both in for non-interactive runs.
    const xcode: XcodeConfig =
      proj.kind === "workspace"
        ? { workspace: proj.path, scheme: proj.name }
        : { project: proj.path, scheme: proj.name };
    return [{ name: sanitizeProjectName(proj.name), dirs: ["."], cwd: root, scripts: {}, xcode }];
  },

  // Best-effort live commands (used for the `doctor` preview before adopt bakes
  // concrete ones). Guesses the scheme as the project basename — correct for the
  // common single-scheme case; the first real verb auto-adopts and replaces these.
  async command(verb: Verb, _pkg: DetectedPackage, root: string): Promise<string | null> {
    const proj = await findXcodeProject(root);
    if (!proj) return null;
    const cmds = xcodeCommands(projectFlag(proj));
    switch (verb) {
      case "dev":
        return cmds.dev;
      case "build":
        return cmds.build;
      case "test":
        return cmds.test;
      case "lint":
        return existsSync(path.join(root, ".swiftlint.yml")) ? "swiftlint" : null;
      case "deploy":
        return null;
    }
  },

  // Configure tier (DESIGN §3): inspect the project once and emit a concrete
  // `xcode` block + baked verb commands for premo.json. With several shared
  // schemes (the dev/prod split) it bakes a per-env map and seeds the project's
  // `environments` axis (DESIGN §15.4); a single scheme is the unnamed-env case.
  async adopt(root: string): Promise<Partial<ProjectManifestInput>> {
    const proj = await findXcodeProject(root);
    if (!proj) return {};

    // dev/build/test are no longer baked: the `xcode` block drives them live
    // through the xcode runner (core/runners) at resolve time, so the recipe
    // stays in premo (upgradeable, no bash-in-JSON) instead of frozen in every
    // repo's config. Only a swiftlint `lint` — a genuinely editable string — is
    // materialized.
    const commands: Record<string, string> = {};
    if (existsSync(path.join(root, ".swiftlint.yml"))) commands.lint = "swiftlint";
    const withCommands = (m: Partial<ProjectManifestInput>): Partial<ProjectManifestInput> =>
      Object.keys(commands).length ? { ...m, commands } : m;

    const schemes = await listSchemes(root, proj);

    // Single (or no) scheme: the one-environment case — a bare scheme/bundleId.
    if (schemes.length <= 1) {
      const scheme = schemes.includes(proj.name) ? proj.name : (schemes[0] ?? proj.name);
      if (schemes.length === 0) {
        log.warn(
          `No shared scheme found. Share one in Xcode (Product → Scheme → Manage Schemes → ` +
            `check "Shared") so CLI builds are reproducible; using "${scheme}" for now.`,
        );
      }
      const { bundleId, platforms } = await buildSettings(root, proj, scheme);
      const defaultDestination = await pickDefaultDestination(platforms);
      return withCommands({
        xcode: {
          [proj.kind]: proj.path,
          scheme,
          ...(bundleId ? { bundleId } : {}),
          ...(defaultDestination ? { defaultDestination } : {}),
        },
      });
    }

    // Several shared schemes → an environment per scheme. Build settings (for the
    // per-env bundle id, and the default env's platforms) are probed once each.
    const envByScheme = deriveEnvNames(schemes);
    const settings = new Map<string, { bundleId?: string; platforms: string[] }>();
    for (const s of schemes) settings.set(s, await buildSettings(root, proj, s));

    const environments: Record<string, XcodeEnv> = {};
    for (const s of schemes) {
      const { bundleId } = settings.get(s)!;
      environments[envByScheme.get(s)!] = { scheme: s, ...(bundleId ? { bundleId } : {}) };
    }

    const envNames = schemes.map((s) => envByScheme.get(s)!);
    const defaultEnv = pickDefaultEnv(envNames);
    const defaultScheme = schemes.find((s) => envByScheme.get(s) === defaultEnv)!;
    const defaultDestination = await pickDefaultDestination(settings.get(defaultScheme)!.platforms);
    log.info(`Detected ${schemes.length} schemes → environments: ${envNames.join(", ")}.`);

    return withCommands({
      xcode: {
        [proj.kind]: proj.path,
        environments,
        ...(defaultDestination ? { defaultDestination } : {}),
      },
      environments: envNames.map((n) => ({
        name: n,
        ...(n === defaultEnv ? { default: true } : {}),
      })),
    });
  },
};

// Derive a short env name per scheme by stripping the shared app-name prefix
// ("Chess Dev" / "Chess Prod" → dev / prod), falling back to the sanitized full
// scheme when stripping leaves nothing, and disambiguating any collisions.
export function deriveEnvNames(schemes: string[]): Map<string, string> {
  const pfx = commonPrefixLen(schemes);
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const s of schemes) {
    const base = sanitizeEnvName(s.slice(pfx)) || sanitizeEnvName(s) || "env";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    map.set(s, name);
  }
  return map;
}

// The env used when `--env` is omitted: prefer a dev-ish name, else the first.
function pickDefaultEnv(envNames: string[]): string {
  return envNames.find((n) => ["dev", "debug", "development", "local"].includes(n)) ?? envNames[0]!;
}

function sanitizeEnvName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function commonPrefixLen(strings: string[]): number {
  const first = strings[0] ?? "";
  let i = 0;
  while (i < first.length && strings.every((s) => s[i] === first[i])) i++;
  return i;
}

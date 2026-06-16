import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifestInput, Verb, XcodeConfig, XcodeEnv } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { log } from "../logger.js";
import {
  buildSettings,
  detectGeneratorPrebuild,
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
    // A generated project (xcodegen) must be regenerated before xcodebuild —
    // surface it as a prebuild hook even pre-adopt, so dev/build/test work.
    const prebuild = (await detectGeneratorPrebuild(root)) ?? undefined;
    return [
      {
        name: sanitizeProjectName(proj.name),
        dirs: ["."],
        cwd: root,
        scripts: {},
        xcode,
        ...(prebuild ? { prebuild } : {}),
      },
    ];
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
    // A generated project (xcodegen) gets a baked `prebuild` so the .xcodeproj is
    // (re)generated before every dev/build/test — like the editable `lint`
    // string, this is a genuinely project-specific command worth materializing.
    const prebuild = (await detectGeneratorPrebuild(root)) ?? undefined;
    const withCommands = (m: Partial<ProjectManifestInput>): Partial<ProjectManifestInput> => ({
      ...m,
      ...(Object.keys(commands).length ? { commands } : {}),
      ...(prebuild ? { prebuild } : {}),
    });

    const schemes = await listSchemes(root, proj);

    // One scheme, or several that AREN'T environment variants (distinct products
    // / extensions — an app + its widget, or app + API). Treat as the single,
    // unnamed-environment case using the primary app scheme; only a genuine
    // dev/prod-style variant set (below) seeds the environments axis.
    if (schemes.length <= 1 || !isEnvironmentSplit(schemes)) {
      const primary = schemes.find((s) => s.toLowerCase() === proj.name.toLowerCase());
      const scheme = primary ?? schemes[0] ?? proj.name;
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

    // Several shared schemes that ARE env variants → an environment per scheme.
    // Build settings (per-env bundle id, default env's platforms) probed once each.
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

// Environment-ish suffixes that mark a scheme set as a dev/prod-style variant
// split (vs. distinct products/extensions). Conservative on purpose: an unusual
// env name just falls back to the single-scheme case rather than inventing a
// bogus axis (e.g. an app + widget "Glade"/"GladeControls", or app + API
// "finances"/"api" must NOT become environments).
const ENV_TOKENS = new Set([
  "dev",
  "develop",
  "development",
  "debug",
  "local",
  "prod",
  "production",
  "release",
  "staging",
  "stage",
  "beta",
  "qa",
  "test",
  "testing",
  "alpha",
  "adhoc",
  "enterprise",
  "appstore",
  "nightly",
  "canary",
  "preview",
  "demo",
  "sandbox",
]);

// Do these shared schemes represent the same app built for different
// environments (so they should seed the environments axis), as opposed to
// several distinct products/extensions? True only when, after stripping the
// shared app-name prefix, EVERY remainder is a recognized environment token —
// "Chess Dev"/"Chess Prod" → dev/prod (yes); "Glade"/"GladeControls" → ""/
// "controls" (no); "finances"/"api" → finances/api (no).
export function isEnvironmentSplit(schemes: string[]): boolean {
  if (schemes.length < 2) return false;
  const pfx = commonPrefixLen(schemes);
  return schemes.every((s) => {
    const rem = sanitizeEnvName(s.slice(pfx));
    return rem.length > 0 && ENV_TOKENS.has(rem);
  });
}

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

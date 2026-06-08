import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifestInput, Verb } from "../../manifest/types.js";
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
    return [{ name: sanitizeProjectName(proj.name), dirs: ["."], cwd: root, scripts: {} }];
  },

  // Best-effort live commands (used for the `doctor` preview before adopt bakes
  // concrete ones). Guesses the scheme as the project basename — correct for the
  // common single-scheme case; the first real verb auto-adopts and replaces these.
  async command(verb: Verb, _pkg: DetectedPackage, root: string): Promise<string | null> {
    const proj = await findXcodeProject(root);
    if (!proj) return null;
    const cmds = xcodeCommands(projectFlag(proj), proj.name);
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
  // `xcode` block + baked verb commands for premo.json.
  async adopt(root: string): Promise<Partial<ProjectManifestInput>> {
    const proj = await findXcodeProject(root);
    if (!proj) return {};

    const schemes = await listSchemes(root, proj);
    const scheme = schemes.includes(proj.name) ? proj.name : (schemes[0] ?? proj.name);
    if (schemes.length === 0) {
      log.warn(
        `No shared scheme found. Share one in Xcode (Product → Scheme → Manage Schemes → ` +
          `check "Shared") so CLI builds are reproducible; using "${scheme}" for now.`,
      );
    }

    const { bundleId, platforms } = await buildSettings(root, proj, scheme);
    const defaultDestination = await pickDefaultDestination(platforms);

    // dev/build/test are no longer baked: the `xcode` block below drives them
    // live through the xcode runner (core/runners) at resolve time, so the recipe
    // stays in premo (upgradeable, no bash-in-JSON) instead of frozen in every
    // repo's config. Only a swiftlint `lint` — a genuinely editable string — is
    // materialized.
    const commands: Record<string, string> = {};
    if (existsSync(path.join(root, ".swiftlint.yml"))) commands.lint = "swiftlint";

    return {
      xcode: {
        [proj.kind]: proj.path,
        scheme,
        ...(bundleId ? { bundleId } : {}),
        ...(defaultDestination ? { defaultDestination } : {}),
      },
      ...(Object.keys(commands).length ? { commands } : {}),
    };
  },
};

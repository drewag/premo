import type { ProjectManifest, Script, Verb, XcodeConfig } from "../manifest/types.js";
import { VERBS } from "../manifest/types.js";
import { type Adapter, detectAdapter, getAdapter } from "./adapters/index.js";
import { resolveScript } from "./runners/index.js";

// Verbs the xcode runner owns. For a unit carrying an `xcode` block, these
// default to an implied `{ run: "xcode" }` spec when no command is configured —
// so the recipe is generated live by the runner, never baked into premo.json.
const XCODE_VERBS = new Set<Verb>(["dev", "build", "test"]);
const XCODE_SPEC: Script = { run: "xcode" };

// A fully-resolved package: where to run, what it owns (for affected detection),
// and the concrete command for each verb (config > adapter). The build/test/lint
// unit; see DESIGN.md §13.
export interface Package {
  name: string;
  dirs: string[];
  affects: string[];
  affectsExcept: string[];
  cwd: string;
  commands: Partial<Record<Verb, string>>;
  // "service" (server) vs "command" (run-once/interactive CLI). Drives the dev
  // run strategy (piped multiplex vs inherited TTY) and port allocation.
  kind: "service" | "command";
  // Present when this package is a native Apple app — drives destination
  // resolution for dev/build/test (DESIGN §13.2).
  xcode?: XcodeConfig;
}

async function adapterFor(root: string, manifest: ProjectManifest): Promise<Adapter | null> {
  if (manifest.adapter) {
    const named = getAdapter(manifest.adapter);
    if (named) return named;
  }
  return detectAdapter(root);
}

// Resolution order per DESIGN.md §3: per-package config > project config > adapter.
export async function resolvePackages(root: string, manifest: ProjectManifest): Promise<Package[]> {
  const adapter = await adapterFor(root, manifest);
  const detected = adapter ? await adapter.packages(root) : [];
  const detectedByName = new Map(detected.map((d) => [d.name, d]));
  const configByName = new Map(manifest.packages.map((p) => [p.name, p]));

  const names = new Set<string>([...detectedByName.keys(), ...configByName.keys()]);
  const packages: Package[] = [];

  for (const name of names) {
    const det = detectedByName.get(name);
    const cfg = configByName.get(name);
    const dirs = cfg?.dirs.length ? cfg.dirs : (det?.dirs ?? ["."]);
    const cwd = det?.cwd ?? root;

    // The xcode block governing this package: a monorepo member's own block, or —
    // for a single-app repo — the top-level one. Drives the implied xcode runner.
    const xcode = cfg?.xcode ?? manifest.xcode;

    const commands: Partial<Record<Verb, string>> = {};
    for (const verb of VERBS) {
      // Resolution order (DESIGN §3): per-package config > project config >
      // implied xcode runner (dev/build/test of a native app) > adapter live
      // command. A Script may be a raw string or a predefined spec; resolveScript
      // turns a spec into its command via the runner registry.
      const explicit: Script | undefined =
        cfg?.commands[verb] ??
        manifest.commands[verb] ??
        (xcode && XCODE_VERBS.has(verb) ? XCODE_SPEC : undefined);
      const cmd =
        explicit !== undefined
          ? resolveScript(explicit, verb, { xcode })
          : det && adapter
            ? ((await adapter.command(verb, det, root)) ?? undefined)
            : undefined;
      if (cmd) commands[verb] = cmd;
    }

    packages.push({
      name,
      dirs,
      affects: cfg?.affects ?? [],
      affectsExcept: cfg?.affectsExcept ?? [],
      cwd,
      commands,
      kind: det?.kind ?? "service",
      ...(cfg?.xcode ? { xcode: cfg.xcode } : {}),
    });
  }

  // A project with neither adapter nor declared packages still gets one implicit
  // package, so project-level `commands` (or a helpful message) still work.
  if (packages.length === 0) {
    const commands: Partial<Record<Verb, string>> = {};
    for (const verb of VERBS) {
      const s = manifest.commands[verb];
      const cmd = s !== undefined ? resolveScript(s, verb, {}) : undefined;
      if (cmd) commands[verb] = cmd;
    }
    packages.push({
      name: manifest.name,
      dirs: ["."],
      affects: [],
      affectsExcept: [],
      cwd: root,
      commands,
      kind: "service",
    });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

# Contributing to premo

premo is a universal task runner: a closed set of verbs (`dev build test lint deploy`) that resolves to a shell command through three tiers — explicit `premo.json` config → a built-in **adapter** → a helpful not-implemented message. Read [DESIGN.md](./DESIGN.md) for the full model; this doc is the practical "how to add support for a new stack."

## Setup

```bash
yarn install
source ./bin/activate.sh   # `premo` now points at this clone
yarn build                 # typecheck
yarn test                  # Vitest
yarn lint                  # eslint + prettier
```

All three (`build`, `test`, `lint`) must pass before a PR. CI runs them on every push.

## The most valuable contribution: a new adapter

An **adapter** teaches premo to recognize a stack and supply default verb commands with zero config. Adding one fills a column of the (verb × project-type) matrix that is premo's coverage goal.

An adapter implements the interface in [`src/core/adapters/index.ts`](./src/core/adapters/index.ts):

```ts
export interface Adapter {
  name: string;
  detect(root: string): Promise<boolean>; // is this that kind of repo?
  packages(root: string): Promise<DetectedPackage[]>; // the build/test/lint units
  command(verb: Verb, pkg: DetectedPackage, root: string): Promise<string | null>; // verb → shell string (async)
  adopt?(root: string): Promise<Partial<ProjectManifestInput>>; // optional: bake concrete config
}
```

The smallest real example is **[`node-scripts.ts`](./src/core/adapters/node-scripts.ts)** (~26 lines): `detect` checks for a `package.json`, `packages` returns one package rooted at the repo, and `command` maps each verb to the matching `package.json` script. Copy it as a starting template.

### Steps

1. Create `src/core/adapters/<your-stack>.ts` implementing `Adapter`.
2. Register it in the `ADAPTERS` array in `src/core/adapters/index.ts`. **Order matters — most specific first** (e.g. `xcode` before the node adapters, since an iOS repo can also contain a `package.json`).
3. Keep `detect` and `packages` cheap (a `readdir`/file check, not a subprocess) — they run on every command. If you need an expensive probe (`xcodebuild -list`, etc.), do it once in `adopt()` and bake the result into `premo.json`.
4. `command()` is **async** and resolves to a shell string or `null` (one package, one verb). Runtime variability (which simulator, which port) flows through environment variables the command references — see how the `xcode` adapter uses `PREMO_XCODE_DEST`. Don't add per-run branching inside the dispatcher.
5. Add unit tests in `test/unit/` against a tmpdir fixture: assert `detect()`, the `packages()` shape, and that `command()` returns what you expect. Tests must pass with no special host tooling (CI is Linux) — guard or skip anything that needs platform-specific binaries.

### The `adopt()` hook (configure tier)

If detection needs an expensive probe to produce a correct config, implement `adopt()`. It runs once during `premo adopt`, inspects the repo, and returns the manifest fields to bake (`commands`, a stack-specific config block, etc.). This is how the `xcode` adapter compiles a scheme + default destination into `premo.json` so the verbs never shell out to `xcodebuild -list` again. Adapters that resolve everything live (the node ones) omit it.

## Conventions

- **Don't grow the verb vocabulary.** Five core verbs is the design. New capability goes into project config, not new verbs.
- **Every capability is a project-level contract.** No `if (wasScaffolded)` branches — behavior derives from declared `premo.json` config, and a hand-written manifest must behave identically to a generated one.
- **No telemetry, ever.** No network calls, no analytics.
- TypeScript strict mode; ESM with `.js` import specifiers (NodeNext). Match the surrounding style; prettier enforces formatting.

## Architecture primer

The dispatcher is deliberately dumb: it resolves a verb to a command string and runs it. That resolution walks **three tiers, first hit wins** — explicit `premo.json` config → a built-in adapter → a helpful not-implemented message — so an unconfigured repo never dead-ends. Entry-point trail: `bin/premo.ts` boots `src/cli/program.ts`, which builds the Commander program from `src/cli/commands/index.ts` — that file is **the single source of truth for which commands exist**. There are two discovery axes: `packages` are the `build`/`test`/`lint` units (a directory of code), while `targets` are the `dev`/`deploy` units (a runnable/shippable composing one or more packages); a single-package repo has one of each and they coincide invisibly. See [DESIGN.md §13](./DESIGN.md#13-monorepo-model--packages--targets) for the full model.

- `bin/premo.ts` — entry point (boots the program, parses argv).
- `src/cli/program.ts` — builds the Commander program; `src/cli/commands/index.ts` is the authoritative command list.
- `src/core/` — the engine: `adapters/`, verb→command resolution, `run.ts` (execution), `affected.ts` (changed-files → packages), `git.ts`, port registry, supervision.
- `src/manifest/types.ts` — the Zod schema for `premo.json`.
- `test/unit/` — Vitest unit tests.

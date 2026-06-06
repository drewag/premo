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
  targets(root: string): Promise<DetectedTarget[]>; // the units of work
  command(verb: Verb, target: DetectedTarget, root: string): string | null; // verb → shell string
  adopt?(root: string): Promise<Partial<ProjectManifestInput>>; // optional: bake concrete config
}
```

The smallest real example is **[`node-scripts.ts`](./src/core/adapters/node-scripts.ts)** (~30 lines): `detect` checks for a `package.json`, `targets` returns one target rooted at the repo, and `command` maps each verb to the matching `package.json` script. Copy it as a starting template.

### Steps

1. Create `src/core/adapters/<your-stack>.ts` implementing `Adapter`.
2. Register it in the `ADAPTERS` array in `src/core/adapters/index.ts`. **Order matters — most specific first** (e.g. `xcode` before the node adapters, since an iOS repo can also contain a `package.json`).
3. Keep `detect` and `targets` cheap (a `readdir`/file check, not a subprocess) — they run on every command. If you need an expensive probe (`xcodebuild -list`, etc.), do it once in `adopt()` and bake the result into `premo.json`.
4. `command()` returns a **static shell string** or `null`. Runtime variability (which simulator, which port) flows through environment variables the command references — see how the `xcode` adapter uses `PREMO_XCODE_DEST`. Don't add per-run branching inside the dispatcher.
5. Add unit tests in `test/unit/` against a tmpdir fixture: assert `detect()`, the `targets()` shape, and that `command()` returns what you expect. Tests must pass with no special host tooling (CI is Linux) — guard or skip anything that needs platform-specific binaries.

### The `adopt()` hook (configure tier)

If detection needs an expensive probe to produce a correct config, implement `adopt()`. It runs once during `premo adopt`, inspects the repo, and returns the manifest fields to bake (`commands`, a stack-specific config block, etc.). This is how the `xcode` adapter compiles a scheme + default destination into `premo.json` so the verbs never shell out to `xcodebuild -list` again. Adapters that resolve everything live (the node ones) omit it.

## Conventions

- **Don't grow the verb vocabulary.** Five core verbs is the design. New capability goes into project config, not new verbs.
- **Every capability is a project-level contract.** No `if (wasScaffolded)` branches — behavior derives from declared `premo.json` config, and a hand-written manifest must behave identically to a generated one.
- **No telemetry, ever.** No network calls, no analytics.
- TypeScript strict mode; ESM with `.js` import specifiers (NodeNext). Match the surrounding style; prettier enforces formatting.

## Project layout

- `bin/premo.ts` — entry point (registers commands, parses argv).
- `src/cli/` — one file per command; `program.ts` builds the Commander program.
- `src/core/` — the engine: `adapters/`, `targets.ts` (verb→command resolution), `run.ts` (execution), `affected.ts` (changed-files → targets), `git.ts`, `port-registry.ts`, supervision.
- `src/manifest/types.ts` — the Zod schema for `premo.json`.
- `test/unit/` — Vitest unit tests.

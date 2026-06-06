# AGENTS.md

Guidance for coding agents. Two audiences: agents **using premo inside a project**, and agents **contributing to premo itself**.

## Using premo in a project

premo is a universal task runner. In any repo that has a `premo.json` (or any repo at all — premo auto-detects common stacks), prefer premo's verbs over guessing the project's bespoke scripts. The vocabulary is **closed and identical everywhere**, so you never have to reverse-engineer how _this_ repo runs.

| Verb           | Use it to…                                                            |
| -------------- | --------------------------------------------------------------------- |
| `premo dev`    | Run the project locally (foreground/watch). `--background` to detach. |
| `premo build`  | Build the targets affected by the current changes. `--all` for all.   |
| `premo test`   | Test the affected targets. `--all` runs every suite.                  |
| `premo lint`   | Auto-fix lint on changed files. `--dry` checks only.                  |
| `premo deploy` | Ship what changed vs. what's deployed (git-ref tracked).              |
| `premo stop`   | Stop processes started by `dev --background`.                         |
| `premo logs`   | Tail background process logs.                                         |

### Orient yourself before acting

Run these first — they have **`--json`** for stable, parseable output:

```bash
premo doctor --json   # host prereqs + which verbs are wired per target + gaps
premo adopt --json    # detect the stack and write premo.json (first-time setup)
premo ports --json    # the project's allocated port (PORT env for dev)
```

`doctor --json` is the single best command to understand a repo: it returns the
adapter, the git/affected readiness, the port allocation, and a per-target
verb-wiring matrix with an `unwired` list. Read that instead of grepping for
scripts.

### Rules of thumb

- **Don't grow the verb set.** Five core verbs is the whole point. If something doesn't fit, it belongs in project config (`commands`, `shells`), not a new verb.
- **Don't special-case "did premo scaffold this."** Every capability is a project-level contract declared in `premo.json`; a hand-written manifest behaves identically to a generated one.
- **Prefer `premo <verb>` over the raw tool** when wiring exists, so behavior stays consistent across repos.
- premo only reads `premo.json` and shells out — no telemetry, no network of its own. But it **runs the commands the project declares**, so only invoke it in repositories you trust (same as `npm run`). See [SECURITY.md](./SECURITY.md).

## Contributing to premo itself

- **Architecture:** closed verbs → resolved through three tiers (config → adapter → helpful-not-implemented). The dispatcher stays dumb: resolve verb → command string → run it. See [DESIGN.md](./DESIGN.md).
- **The extension point is an `Adapter`** (`src/core/adapters/index.ts`): `detect` / `targets` / `command`, plus an optional `adopt` hook to bake concrete config. The smallest example is `node-scripts.ts` (~30 lines). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the walkthrough.
- **The manifest schema** is Zod in `src/manifest/types.ts`; every field is optional/additive.
- **Run from source:** `source ./bin/activate.sh`, then `premo` resolves to this clone.
- **Before you finish:** `yarn build` (typecheck), `yarn test` (Vitest), `yarn lint`. All three must pass.
- **No telemetry, ever.** Don't add network calls or analytics.

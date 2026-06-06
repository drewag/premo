# premo

**A universal remote for your projects.** One small set of verbs — `dev`, `build`, `test`, `lint`, `deploy` — that works the **same way in every repo**, whether premo set it up or not.

> Status: **v0, in active construction.** See [DESIGN.md](./DESIGN.md) for the full design.

The daily pain isn't starting a project — it's _returning_ to one from three months ago and having to re-derive how to run, build, test, or deploy it. premo erases that: go into any project you own and press the same buttons.

```bash
premo dev          # run it locally
premo build        # build what changed
premo test         # test what changed
premo lint         # fix lint on changed files
premo deploy       # ship what changed
```

You never re-learn a project. Muscle memory transfers across every repo.

## How it works

premo resolves each verb through three tiers (first hit wins):

1. **Explicit config** — a `premo.json` maps the verb to a command. Always wins.
2. **Built-in adapter** — premo sniffs the repo (npm/yarn scripts, yarn workspaces, Xcode…) and supplies a sensible default, so a standard repo Just Works with zero config.
3. **Helpful not-implemented** — neither resolves it → an actionable message telling you the next move, never a crash.

premo only ever reads a `premo.json` and shells out to your real toolchain. Uninstalling it breaks nothing.

## Supported stacks

| Adapter           | What it covers                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| `node-scripts`    | Single-package Node app — maps verbs to your `package.json` scripts          |
| `yarn-workspaces` | A workspaces monorepo — one target per package, affected-aware               |
| `xcode`           | Native iOS/macOS apps — build/test/run on a simulator or device from the CLI |

Unknown stacks still respond with a helpful message; `premo adopt` writes a starter `premo.json` you can edit.

## Quick start

```bash
yarn install
source ./bin/activate.sh   # defines `premo` in this shell only (no PATH change)

cd ~/your/project
premo doctor               # what's wired here, and what's missing
premo dev                  # run it
```

`premo adopt` detects the stack and writes a `premo.json`. Worktree-local state (background PIDs, the last xcode run destination) lives in `.premo-local.json`; both it and the build cache are gitignored automatically.

## Development

Requires Node 22+.

```bash
yarn install
yarn test       # unit tests
yarn lint
yarn build      # typecheck / emit
```

## License

MIT

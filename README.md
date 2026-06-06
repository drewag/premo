# premo

**A universal remote for your projects.** One small set of verbs — `dev`, `build`, `test`, `lint`, `deploy` — that works the **same way in every repo**, whether premo set it up or not.

> Status: **v0, in active construction.** Not yet on npm — run it from source (see [Install](#install)). See [DESIGN.md](./DESIGN.md) for the full design.

The daily pain isn't starting a project — it's _returning_ to one from three months ago and having to re-derive how to run, build, test, or deploy it. premo erases that: go into any project you own and press the same buttons.

```bash
premo dev          # run it locally
premo build        # build what changed
premo test         # test what changed
premo lint         # fix lint on changed files
premo deploy       # ship what changed
```

You never re-learn a project. Muscle memory transfers across every repo.

## Built for the AI-native workflow

premo is designed to be driven by **coding agents** as much as by humans — and especially by humans working _through_ agents. The fixed verb vocabulary is the point: an agent dropped into an unfamiliar repo doesn't have to read the CI config, guess the package manager, or grep for a dev script. It runs `premo dev` / `premo test` / `premo build` and they mean the same thing everywhere.

- **A closed, predictable vocabulary.** Five verbs, identical semantics in every repo. Nothing for an agent to discover or get wrong.
- **Machine-readable output.** `premo doctor --json`, `premo adopt --json`, and `premo ports --json` emit stable JSON so an agent can see exactly what's wired and what's missing without scraping human text.
- **A repo-level [`AGENTS.md`](./AGENTS.md)** teaches an agent the vocabulary and when to reach for premo.
- **An agent-executed adoption tier.** When a repo is too novel for the built-in detectors, premo emits a `SKILL.md` that teaches a coding agent how to wire premo up for that stack (the "skill tier" in [DESIGN.md §3](./DESIGN.md)).

Humans get muscle memory; agents get a contract. Both press the same buttons.

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

Unknown stacks still respond with a helpful message; `premo adopt` writes a starter `premo.json` you can edit. Adding an adapter is the main way to contribute — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

premo isn't published to npm yet. For now, run it from a clone:

```bash
git clone https://github.com/drewag/premo.git
cd premo
yarn install
source ./bin/activate.sh   # defines `premo` in this shell only (no PATH change)
```

`activate.sh` defines a `premo` shell function pointing at this clone — nothing is written to `$PATH` or any rc file, and `premo-deactivate` removes it. To have it available in every shell, source it from your `~/.zshrc`.

Once published, this becomes `npm i -g premo` (or `npx premo`); the packaging is already in place behind a `private` flag.

## Quick start

```bash
cd ~/your/project
premo doctor               # what's wired here, and what's missing
premo dev                  # run it
```

`premo adopt` detects the stack and writes a `premo.json`. Worktree-local state (background PIDs, the last xcode run destination) lives in `.premo-local.json`; both it and the build cache are gitignored automatically.

## Shell completion

premo ships dynamic completion that knows your project — `premo build <TAB>` completes the real **target names** from `premo.json`, and option values (`--platform`, `--env`, shells) too. It's derived by reflecting the CLI, so it stays correct automatically as commands grow.

`activate.sh` loads it for you in source mode. To install it yourself (or when running the published binary):

```bash
premo completion zsh  > "${fpath[1]}/_premo"     # zsh
premo completion bash > /etc/bash_completion.d/premo   # bash
premo completion fish > ~/.config/fish/completions/premo.fish  # fish
```

(`premo completion` with no argument detects your `$SHELL`.)

## Development

Requires Node 22+.

```bash
yarn install
yarn test       # unit tests
yarn lint       # eslint + prettier
yarn build      # typecheck / emit to dist/
```

## About the name

You _press_ a button on a remote — Latin **_premo_**, "I press" — to make any project do something. It's also the casual sense of "premium." The free npm name and `premo.sh` are the homes.

premo grew out of a project _scaffolder_, which now lives as its own project under the name **strand** (a project is _made of strands_). premo is the everyday task-runner that scaffolder produces configs for; the two share the `premo.json` contract but ship separately.

## License

MIT — see [LICENSE](./LICENSE).

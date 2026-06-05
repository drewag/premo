# strand — design doc

> A universal, opinionated CLI for the everyday verbs of every project you own — `dev`, `build`, `test`, `lint`, `deploy` — that work the **same way in every repo**, scaffolded by strand or not.

Status: **draft v0 — reframed.** strand began as a project _scaffolder_ (compose a repo from "strands"). After vibe-coding several projects, the priority narrowed: the daily pain isn't starting projects, it's _returning_ to one from three months ago and having to re-derive how to run, build, test, or deploy it. So the spine of strand is now a **universal task runner** — one fixed verb vocabulary that works in any repo, with a tiered "figure out this project" intelligence so adoption is cheap. The original scaffolder still exists (it's the current implementation) and is preserved as a **later, secondary capability** in §11. Reference projects that shape the conventions: `~/git/odo/email` (the gold standard for affected-detection, deploy tracking, worktrees), `~/git/personal/finances`, `~/git/personal/turns`.

---

## 1. Vision

Go into _any_ project directory you own and run the same handful of verbs:

```
strand dev          # run it locally, watch mode
strand build        # build the affected targets
strand test         # test the affected targets
strand lint         # fix lint on changed files
strand deploy       # ship what changed
```

You never re-learn a project. Muscle memory transfers across every repo. At an **absolute minimum**, an unconfigured project responds with a _helpful, actionable_ message ("no `build` configured — this looks like a yarn-workspaces repo, run `strand adopt`?") rather than a dead end or a stack trace.

This works on projects strand never scaffolded — the Swift blog, `finances`, anything. Adoption is the cheap part by design.

### Principles

1. **One fixed verb vocabulary.** A small, closed set of verbs (§2). The value _is_ that the set is known and identical everywhere — so we don't grow it casually.
2. **Convention first, config always wins.** Standard stacks work with zero config via built-in adapters. A `strand.json` overrides anything. Three tiers of "make this project work" (§3), escalating only as needed.
3. **Graceful degradation.** Unknown verb or unconfigured project → a helpful message that tells you the next move, never a crash.
4. **Agent-first, with a deterministic floor.** The hardest adoption cases are handled by a skill an agent executes; everything below that is deterministic CLI code.
5. **git is assumed.** Affected-detection, deploy tracking, and worktrees all lean on git. A strand project is a git repo.
6. **Every file is a normal file.** strand reads a `strand.json` and shells out to your real toolchain. Uninstalling it breaks nothing.

### Non-goals (for now)

- Being a build system or task graph engine (Bazel/Nx/Turbo). strand _dispatches_ to your existing tools; it doesn't cache, sandbox, or schedule.
- Polyglot deploy targets beyond "run a command / track a git ref." Deploy is git-ref bookkeeping + per-target commands, not a PaaS.
- Data-branch / stateful-service orchestration. Deferred to its own design pass (§9.2).

---

## 2. The verb vocabulary

The closed P0 set. Each verb takes an optional `[target]` (a named sub-unit of a monorepo); with no target, scope is derived from what changed.

| Verb     | Signature                       | Semantics                                                                                                                                      |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`    | `dev [target] [--background]`   | Run locally in **foreground** (watch mode) by default. `--background` detaches (see `stop`/`logs`). `[target]` selects one unit in a monorepo. |
| `build`  | `build [target] [--all]`        | Build the **affected targets** (those with changed files). `--all` builds every target. `[target]` builds one.                                 |
| `test`   | `test [target] [--all]`         | Test the **affected targets**. `--all` runs every target's suite. `[target]` tests one. (Target-granularity, not file.)                        |
| `lint`   | `lint [target] [--all] [--dry]` | Lint the **changed files** (file-granularity, not target). Auto-fixes by default; `--dry` only checks. `--all` lints the whole tree.           |
| `deploy` | `deploy [target]`               | Ship what's changed vs. what's deployed, tracked through git refs (§6.5). `[target]` deploys one target.                                       |
| `stop`   | `stop`                          | Stop background processes started by `dev --background`.                                                                                       |
| `logs`   | `logs [target]`                 | Tail logs of background processes.                                                                                                             |

**Scope granularity is deliberately split:** `build`/`test`/`deploy` operate at **target** granularity (rebuild/retest/ship a whole unit if any of its files changed); `lint` operates at **file** granularity (lint exactly the changed files). This mirrors `odo/email` and matches how the tools actually work — eslint takes a file list, but you can't "build half a target."

Retained utility commands from the current implementation (secondary, not part of the core verb story): `doctor`, `ports`, `open`, `shell`, `list`, `new`. See §11.

---

## 3. Resolution & the three-tier intelligence model

### Resolution order

For `strand <verb>`, first hit wins:

1. **Explicit config** — `strand.json` maps the verb (and per-target overrides) to a command. Always wins.
2. **Built-in adapter** — strand sniffs the repo (yarn workspaces, package.json scripts, Cargo, …) and supplies a default command. This is the "convention" layer; it's what makes an _unadopted_ standard repo Just Work.
3. **Helpful not-implemented** — neither resolves the verb → print an actionable message: detected stack, the closest guess, and how to wire it (`strand adopt` / `strand set <verb> '<cmd>'`).

### The three tiers are a ratchet

Every project reaches "the verbs work here" through one of three tiers, escalating only as far as needed:

1. **Convention** — a built-in adapter detects the stack and it just works. Zero config.
2. **Configure** — `strand adopt` deterministically inspects the repo and **writes** a `strand.json` (verb commands + targets) for the user to tweak. No agent. For repos that are almost-conventional or need a couple of overrides.
3. **Skill** — when neither covers it (novel stack, or a feature that must be wired into project internals), strand emits a `SKILL.md` that teaches a coding agent how to integrate it. The agent does the bespoke work.

**The crucial property: all three tiers produce the _same artifact_** — "for verb V (in target T), here is the command to run." Convention computes it live; configure bakes it into `strand.json`; skill has the agent write it. So **`strand.json` is the lingua franca** — the compiled output of whichever tier handled you. The core dispatcher stays dumb: resolve verb → command, run it.

### Coverage as a finite matrix

strand's job is to cover a matrix of **(verb × project-type)**. Every cell is handled by tier 1, 2, or 3. This reframes "contributing back" from the old open-ended "build every useful component" into something finishable: **fill in coverage of a finite matrix**, and the ratchet turns one way only — when the _skill_ tier solves a new case with an agent, that solution is a candidate for **promotion**: up into the configurator if it generalizes mechanically, or into a built-in adapter if it's a whole stack. Skill → Configure → Convention.

---

## 4. The affected-targets primitive (the keystone)

`build`, `test`, and `deploy` all sit on top of one small primitive: _given the current changes, which targets are affected?_ In `odo/email` this is ~90 lines (`scripts/lib/changed-services.ts`) and everything else hangs off it. We build this first.

### Change baseline

"Changed" = committed-on-this-branch **plus** the dirty working tree, validated against `odo/email`:

```
base   = git merge-base origin/main HEAD     # configurable via changeBase
files  = git diff --name-only base..HEAD      # committed on the branch
       ∪ git status --porcelain               # staged + unstaged + untracked
```

This is the "everything this branch touches, as a reviewer would see it" set.

### Mapping files → targets

A target owns one or more directory prefixes and may **fan out** to other targets (a shared dir affects its dependents). Declared in `strand.json`:

```json
{
  "changeBase": "origin/main",
  "targets": {
    "frontend": { "dirs": ["frontend/"] },
    "backend": { "dirs": ["backend/", "react-email/"] },
    "shared": {
      "dirs": ["shared/"],
      "affects": ["frontend", "backend", "ios"],
      "affectsExcept": ["shared/src/api/"]
    }
  },
  "affectedCommand": null
}
```

- **`dirs`** — prefixes a target owns. A changed file under a prefix marks that target affected.
- **`affects`** — fan-out edges. A change in `shared/` marks `frontend`/`backend`/`ios` affected too.
- **`affectsExcept`** — path-level exceptions to fan-out. (`odo/email` treats `shared/src/api/` and `shared/src/llm/` as type-only — they don't trigger a full rebuild of dependents. We model this honestly rather than pretend fan-out is clean.)
- **`affectedCommand`** — escape hatch. If set, strand runs it and reads the affected-target list from stdout, bypassing the prefix map entirely. For odd build graphs and tier-3 projects.

**Resolution:** `affected = ⋃` over changed files of `(owning target ∪ its fan-out)`. Then:

- `build` / `test` (no target) → run on the affected set; `--all` → every target; `[target]` → just that one.
- `lint` → ignores targets; works on the raw changed-file list (`--all` → whole tree).
- `deploy` → uses the same machinery to compute, per undeployed commit, which targets it touches (§6.5).

---

## 5. Config: `strand.json`

The existing manifest (`name`, `strands`, `ports`, `data`) stays for scaffolded projects. The task-runner adds **optional, additive** fields so an _adopted_ project needs only the parts it uses:

```jsonc
{
  // task-runner core (new, all optional)
  "commands": {
    "dev": "yarn dev",
    "build": "yarn build",
    "test": "yarn test",
    "lint": "yarn lint",
    "deploy": null, // null/absent → falls through to adapter or not-implemented
  },
  "targets": {
    /* §4 */
  },
  "changeBase": "origin/main",
  "affectedCommand": null,
  "deploy": {
    "envs": ["prod"], // single env ⇒ refs are `deployed/<target>`;
    // multiple ⇒ `deployed/<env>/<target>`
    "targets": {
      "backend": { "command": "..." },
    },
  },
  "worktree": {
    "carry": ["node_modules", ".env"], // §9.1
  },

  // scaffolder fields (existing; see §11)
  "name": "myapp",
  "strands": ["backend", "web-app", "db", "shared"],
  "ports": { "base": 31200, "block": 100 },
}
```

Per-target command overrides live under `targets.<name>.commands.<verb>`; the bare `commands.<verb>` is the project default. Worktree-local, gitignored state (active background PIDs, last-deployed cache) lives in `.strand-local.json` / `.runtime/` as today.

`strand.json` is parsed by `core/project.ts` via Zod (already does this for the existing fields); the new fields extend that schema. Everything new is `.optional()`, so existing scaffolded projects keep validating unchanged.

---

## 6. Per-verb design

### 6.1 `dev` & background supervision

Foreground `dev` is the current behavior (spawn target dev processes, color-prefixed interleaved logs, SIGINT tears down). New: `--background`.

`odo/email` gets supervision "for free" because `dev` is `docker-compose up -d` and Docker owns the lifecycle. A generic strand running `next dev` or `tsx --watch` on the host has no such backstop, so strand owns a **generic supervision layer** (net-new vs. odo):

- On `dev --background`: spawn detached in its own **process group**, write `{ pid, pgid, logPath, target, startedAt }` to `.strand-local.json`, redirect stdout/stderr to `.runtime/<target>.log`, print the pid + log path.
- `stop` → read the records, kill by **process group** (so child watchers/servers die too), clear the records.
- `logs [target]` → tail `.runtime/<target>.log` (all targets interleaved if none given).

`core/runtime.ts` already has pidfile/log plumbing (`writePid`/`readPid`/`clearPid`, `.runtime/` layout) to build this on.

### 6.2 `build`

Affected targets by default (§4); `--all` for everything; `[target]` for one. Each target's build command comes from `targets.<t>.commands.build` → `commands.build` → adapter → not-implemented.

### 6.3 `lint`

**File-granularity** and **auto-fix by default** (the inverse of most tools — deliberate; the tree is in git). Default: compute the changed-file list (§4 baseline), pass it to the target's linter(s) and fix in place. `--dry` → check only, non-zero exit on findings. `--all` → whole tree. No separate `format` verb — fix-by-default subsumes it.

### 6.4 `test`

**Target-granularity** (§2): default runs the suites of affected targets; `--all` runs every suite; `[target]` runs one. (File-level test-impact analysis is explicitly _not_ attempted — "affected target" is the unit.)

### 6.5 `deploy`

Pure-git tracking lifted from `odo/email` (no external state):

- **Per-target deployed ref.** One env → `deployed/<target>`; multiple configured envs → `deployed/<env>/<target>`. The env segment only appears when `deploy.envs` has more than one entry.
- **Change listing.** For each target, `git log <deployed-ref>..<base>` lists undeployed commits; each commit is annotated with the targets it affects via the §4 primitive — so you see exactly what will ship and to which targets.
- **On deploy.** Run the target's deploy command, then advance the ref: checkout `deployed/<…>`, `git merge <base> --ff-only`, tag a version, push branch + tag, return. Fast-forward-only keeps the ref an honest pointer at "the commit currently deployed."

### 6.6 `stop` / `logs`

See §6.1 — they exist to manage `dev --background` and read from the same `.strand-local.json` / `.runtime/` records.

---

## 7. Adapters (the convention tier)

Built-in detectors that supply default verb commands (and enumerate targets) with zero config:

- **yarn-workspaces** (first, matches the reference projects) — reads root `package.json` `workspaces`; each workspace is a target with `dirs: ["<path>/"]`; verb commands map to `yarn workspace <t> <script>` when the script exists.
- **package.json scripts** (single-package node) — maps verbs to `yarn <script>` / `npm run <script>` when present.
- Future: Cargo, Go, Make passthrough, etc. — each new adapter fills a column of the (verb × project-type) matrix.

`strand adopt` is the **configure tier**: run the best-matching adapter's detection, then _write_ the resolved `commands` + `targets` into `strand.json` so the user can edit a concrete starting point instead of relying on live magic. The **skill tier** emits a `SKILL.md` for an agent when detection can't produce a working config.

---

## 8. CLI architecture (current → target)

Commander-based TS app (`bin/strand.ts` → `src/cli/registry.ts`), run via `tsx`. What the task-runner reuses vs. adds:

**Reuse (already implemented):**

- `core/project.ts` — load/save/validate `strand.json` (Zod). Extend schema with §5 fields.
- `core/runtime.ts` — `.runtime/` pidfiles + logs → foundation for §6.1 supervision.
- `core/logger.ts`, `core/env.ts`, command registry, the existing `dev`/`stop` process-spawning.

**Add (net-new):**

- `core/git.ts` — `mergeBase`, `diffNames`, `porcelainStatus`, ref read/advance for deploy.
- `core/affected.ts` — the §4 primitive (files → targets, fan-out, exceptions, `affectedCommand`).
- `core/adapters/` — detector + default-command providers (§7); `adopt` command on top.
- `core/supervise.ts` — detached spawn / process-group kill / log tail (§6.1).
- `core/deploy.ts` — change listing + ref bookkeeping (§6.5).
- New commands: `build`, `test`, `lint`, `deploy`, `logs`, `adopt`, `set` (and generalize `dev` with `--background`, `stop` with process-group kill).

---

## 9. P1 — worktree & data-branch

### 9.1 Worktree support

Mostly generic, lifted from `odo/email` (`scripts/tree.ts`):

- `git worktree add` on a feature branch, then **replay the un-committed local state** the project needs to run.
- The expensive bit (`node_modules`) is cloned **copy-on-write** (`cp -Rc` on macOS, `cp -al` on Linux); small files (`.env`) are copied.
- _What_ to carry is the only project-specific part → declared as `worktree.carry` (§5), COW the default strategy for directories.

(odo's per-worktree port-block allocation is its own concern; strand's hash-derived port base already gives deterministic per-project ports, and per-worktree port isolation can layer on later if needed.)

### 9.2 Data-branch — deferred

`odo/email`'s data-branches (per-branch Postgres/Redis/Qdrant volumes, per-branch encryption secrets, port blocks) are deeply tied to having stateful services — meaningless for a static site. strand will **not** ship a generic data-branch built-in. A stateful project opts in via a tier-3 skill / declared plumbing. Its "friendly semantics" (clone semantics, secret handling, lifecycle vs. worktrees) deserve a dedicated design pass and are explicitly out of scope here.

---

## 10. Decisions (locked)

Carried forward from the scaffolder design (still true):

1. **Yarn classic (1.x) + workspaces.**
2. **`strand.json` at project root**, versioned (`"version": "0"`). Worktree-local state in `.strand-local.json` (gitignored).
3. **Node 22 LTS.**
4. **Tiny custom token replacer** for templates (no Handlebars/EJS).
5. **No telemetry, ever.**
6. **Hash-derived default port base** (30000–49999, 100-port blocks), pinned in `strand.json`. Still used by scaffolded projects and `dev`.
7. **Name: `strand`.** (AWS Strands Agents shadow accepted.)
8. **Stack: commander + execa + zod + yaml + picocolors; tsx to run; Vitest to test.**

New, from the task-runner reframe:

9. **Fixed, closed verb vocabulary** (§2): `dev build test lint deploy stop logs`. Growing it is a deliberate decision, not a default.
10. **Resolution order is config → adapter → helpful-not-implemented** (§3). An unconfigured project never dead-ends.
11. **Three tiers are a ratchet that all emit the same artifact** (verb→command in `strand.json`). Contribute-back = filling/promoting cells of the (verb × project-type) matrix.
12. **The affected primitive is the keystone** (§4): baseline = `merge-base origin/main` diff + `status --porcelain`; targets declare `dirs`/`affects`/`affectsExcept`; `affectedCommand` is the escape hatch.
13. **Scope granularity is split:** `build`/`test`/`deploy` are target-granular; `lint` is file-granular. `test --all` means all _targets_, not file-level impact analysis.
14. **`lint` auto-fixes by default; `--dry` only checks.** No separate `format` verb.
15. **Deploy is git-ref bookkeeping** (§6.5): `deployed/<target>` refs, ff-only advance + version tag, `git log` for the undeployed change listing. **Single env by default; multiple supported**, and the `<env>` ref segment appears only when more than one env is configured.
16. **strand owns a generic background-supervision layer** — detached process-group spawn + pidfile + logfile + group-kill — because we can't lean on Docker's lifecycle for host processes.
17. **git is assumed.** Affected-detection, deploy, and worktrees all require a git repo.
18. **Data-branches are out of scope** (§9.2); a stateful project opts in via tier-3 plumbing, designed separately.

---

## 11. Deferred — the component / scaffolding vision

The current implementation **is** a working scaffolder, and it's retained — it's just no longer the spine. Condensed so the ideas aren't lost (full prior text is in git history):

- **`strand new --with <strands>`** scaffolds a typed monorepo from composable **strands** (`shared`, `db`, `backend`, `web-app` exist today, each with templates, compose fragments, ports, dev/open/shell metadata). `doctor`, `list`, `ports`, `open`, `shell` support this flow and are all implemented.
- **Content tiers** (managed vs. bootstrap), **integration skills** (`strands/<a>/integrations/<b>/SKILL.md` an agent runs against real code), and **vendored snippets** (`.strand/lib/*` — strand-owned single TS files with drift-hashing) were designed for safely growing a scaffolded project over time.
- **Contribute-back** (`strand contribute`, `// STRAND_NOTE:` markers, `strand link`) was the friction-free path for sending generalizable fixes back. Under the reframe, this becomes the **promotion ratchet** of §3: skill → configure → convention.

How this relates to the task-runner spine: the verb layer works on **any** repo, scaffolded or not. Scaffolding is one way to _produce_ a repo that already has a good `strand.json`; the task-runner is what you use every day afterward, regardless of origin. Reviving the scaffolder's deeper features (add/remove/sync, tiers, snippets) waits until the verb layer is solid.

---

## 12. Phased roadmap

- **v0.0 (shipped):** scaffolder skeleton — `doctor`, `new`, `dev`, `stop`, `list`, `ports`, `open`, `shell`; four strands; core modules (`project`, `strands`, `ports`, `compose`, `runtime`, `templater`, `env`, `logger`); unit + integration tests.
- **v0.1 (the task-runner spine — current priority):**
  - `core/git.ts` + `core/affected.ts` (the §4 keystone).
  - `strand.json` schema extension (`commands`, `targets`, `changeBase`, `affectedCommand`).
  - `build`, `test` (affected-aware), `lint` (file-based, auto-fix).
  - `dev --background` + generic supervision; `stop` (group-kill) + `logs`.
  - yarn-workspaces + package.json adapters; `strand adopt` (configure tier) + helpful not-implemented messages.
  - **Dogfood target:** adopt `~/git/personal/finances` and one freshly-migrated Next.js project with only a `strand adopt`-generated config.
- **v0.2:** `deploy` (git-ref tracking, change listing, single-env; multi-env spec in place). First real VPS deploy.
- **v0.3:** worktree support (§9.1).
- **Later:** skill tier (`SKILL.md` emission for novel stacks) + promotion tooling; revive scaffolder depth (§11) as warranted; data-branch design pass.

### Testing implications

Keep the unit + integration split. Add **fixture repos that represent _adopted_ (non-scaffolded) projects** — a yarn-workspaces monorepo, a single-package node app — and assert: adapter detection, affected-target resolution against scripted git states, `lint --dry` on a changed-file set, and `deploy` ref bookkeeping against a throwaway git repo. The existing scaffold combo-matrix tests stay for the `new` path.

---

## Appendix A — naming

"strand" works on three axes: a project is _made of strands_; a component is _a strand_; the CLI is _strand_. Short, googleable enough, no npm collision in the `@<user>/strand` namespace. Open to a rename if something better turns up.

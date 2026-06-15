# premo — design doc

> A universal remote for every project you own — the everyday verbs `dev`, `build`, `test`, `lint`, `deploy` that work the **same way in every repo**, set up by premo or not.

Status: **draft v0.** The daily pain isn't starting a project, it's _returning_ to one from three months ago and having to re-derive how to run, build, test, or deploy it. premo is a **universal task runner** — one fixed verb vocabulary that works in any repo, with a tiered "figure out this project" intelligence so adoption is cheap. (premo began life inside a project _scaffolder_; that composition/templates capability now lives in its own project, and premo is the task-runner spine it produces configs for.) Reference projects that shape the conventions: `~/git/odo/email` (the gold standard for affected-detection, deploy tracking, worktrees), `~/git/personal/finances`, `~/git/personal/turns`.

> **Model revision (current):** the single `targets` concept used in §2/§4/§5/§7 has been split into **two axes** — `packages` (the unit of `build`/`test`/`lint`) and `targets` (the unit of `dev`/`deploy`). The authoritative spec is **§13**, which supersedes the relevant parts of those earlier sections. The word `targets` is **reassigned** from "package" to "runnable/shippable."

---

## 1. Vision

Go into _any_ project directory you own and run the same handful of verbs:

```
premo dev          # run it locally, watch mode
premo build        # build the affected targets
premo test         # test the affected targets
premo lint         # fix lint on changed files
premo deploy       # ship what changed
```

You never re-learn a project. Muscle memory transfers across every repo. At an **absolute minimum**, an unconfigured project responds with a _helpful, actionable_ message ("no `build` configured — this looks like a yarn-workspaces repo, run `premo adopt`?") rather than a dead end or a stack trace.

This works on projects premo never set up — the Swift blog, `finances`, anything. Adoption is the cheap part by design.

### Principles

1. **One fixed verb vocabulary.** A small, closed set of verbs (§2). The value _is_ that the set is known and identical everywhere — so we don't grow it casually.
2. **Convention first, config always wins.** Standard stacks work with zero config via built-in adapters. A `premo.json` overrides anything. Three tiers of "make this project work" (§3), escalating only as needed.
3. **Graceful degradation.** Unknown verb or unconfigured project → a helpful message that tells you the next move, never a crash.
4. **Agent-first, with a deterministic floor.** The hardest adoption cases are handled by a skill an agent executes; everything below that is deterministic CLI code.
5. **git is assumed.** Affected-detection, deploy tracking, and worktrees all lean on git. A premo project is a git repo.
6. **Every file is a normal file.** premo reads a `premo.json` and shells out to your real toolchain. Uninstalling it breaks nothing.
7. **Every capability is a project-level contract.** A feature works when the project _declares what it needs_ — a verb command, a `shells` entry, a deploy command. Scaffolding and adapters are just ways to populate that contract; there is no "scaffolded-only" behavior. The same `premo.json` an adapter writes, a human can write by hand, and both behave identically.

### Non-goals (for now)

- Being a build system or task graph engine (Bazel/Nx/Turbo). premo _dispatches_ to your existing tools; it doesn't cache, sandbox, or schedule.
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

Utility commands alongside the core verbs (secondary): `doctor`, `adopt`, `ports`, `open`, `shell`, `share` (§14).

---

## 3. Resolution & the three-tier intelligence model

### Resolution order

For `premo <verb>`, first hit wins:

1. **Explicit config** — `premo.json` maps the verb (and per-target overrides) to a command. Always wins.
2. **Built-in adapter** — premo sniffs the repo (yarn workspaces, package.json scripts, Cargo, …) and supplies a default command. This is the "convention" layer; it's what makes an _unadopted_ standard repo Just Work.
3. **Helpful not-implemented** — neither resolves the verb → print an actionable message: detected stack, the closest guess, and how to wire it (`premo adopt`, `premo skill`, or editing `commands` in `premo.json`).

### The three tiers are a ratchet

Every project reaches "the verbs work here" through one of three tiers, escalating only as far as needed:

1. **Convention** — a built-in adapter detects the stack and it just works. Zero config.
2. **Configure** — `premo adopt` deterministically inspects the repo and **writes** a `premo.json` (verb commands + targets) for the user to tweak. No agent. For repos that are almost-conventional or need a couple of overrides.
3. **Skill** — when neither covers it (novel stack, or a feature that must be wired into project internals), premo emits a `SKILL.md` that teaches a coding agent how to integrate it. The agent does the bespoke work.

**The crucial property: all three tiers produce the _same artifact_** — "for verb V (in target T), here is the command to run." Convention computes it live; configure bakes it into `premo.json`; skill has the agent write it. So **`premo.json` is the lingua franca** — the compiled output of whichever tier handled you. The core dispatcher stays dumb: resolve verb → command, run it.

**Scripts: string or spec.** A command value (a `Script`) is either a raw shell string — the escape hatch, run straight through the shell — or a predefined **`ScriptSpec`** (`{ run: "<runner>" }`) that premo executes through a registered **runner** (`core/runners`). A runner generates the real command live from the unit's declarative facts (the sibling `xcode` block, …), so a multi-step recipe lives in premo — versioned and upgradeable — instead of being materialized as bash into every repo's config. This keeps the dispatcher dumb (it still resolves to one shell-string command) while letting premo _own_ the complexity behind a one-word declaration. A spec can be written explicitly, or **implied** by an adapter (an `xcode` block implies `{ run: "xcode" }` for `dev`/`build`/`test`); a literal string always overrides. xcode is the first runner; compose/make/etc. slot in by extending the `run` enum and registering a runner.

### Coverage as a finite matrix

premo's job is to cover a matrix of **(verb × project-type)**. Every cell is handled by tier 1, 2, or 3. This reframes "contributing back" from the old open-ended "build every useful component" into something finishable: **fill in coverage of a finite matrix**, and the ratchet turns one way only — when the _skill_ tier solves a new case with an agent, that solution is a candidate for **promotion**: up into the configurator if it generalizes mechanically, or into a built-in adapter if it's a whole stack. Skill → Configure → Convention.

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

A target owns one or more directory prefixes and may **fan out** to other targets (a shared dir affects its dependents). Declared in `premo.json`:

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
- **`affectedCommand`** — escape hatch. If set, premo runs it and reads the affected-target list from stdout, bypassing the prefix map entirely. For odd build graphs and tier-3 projects.

**Resolution:** `affected = ⋃` over changed files of `(owning target ∪ its fan-out)`. Then:

- `build` / `test` (no target) → run on the affected set; `--all` → every target; `[target]` → just that one.
- `lint` → ignores targets; works on the raw changed-file list (`--all` → whole tree).
- `deploy` → uses the same machinery to compute, per undeployed commit, which targets it touches (§6.5).

---

## 5. Config: `premo.json`

Every field is **optional and additive**, so an adopted project carries only the parts it uses:

```jsonc
{
  "name": "myapp",
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
  // the project's environments — the orthogonal facet axis (§15); a single
  // implicit `default` env is assumed when omitted. `deploy: true` marks an env
  // as a deploy destination (it replaces the old `deploy.envs` list).
  "environments": [
    { "name": "dev", "default": true },
    { "name": "prod", "deploy": true },
  ],
  "worktree": {
    "carry": ["node_modules", ".env"], // §9.1
  },
  // a conflict-free port block, allocated on adopt for projects that serve
  "ports": { "base": 31200, "block": 100 },
  // present after the xcode adapter adopts a native app; a single scheme/bundleId
  // is the one-environment case, a per-env map (§15) is written when the project
  // exposes several schemes
  "xcode": { "scheme": "Awooga", "defaultDestination": { "platform": "ios-simulator" } },
}
```

Per-target command overrides live under `targets.<name>.commands.<verb>`; the bare `commands.<verb>` is the project default. Worktree-local, gitignored state (active background PIDs, last-deployed cache) lives in `.premo-local.json` / `.runtime/` as today.

`premo.json` is parsed by `core/project.ts` via Zod (already does this for the existing fields); the new fields extend that schema. Everything new is `.optional()`, so existing scaffolded projects keep validating unchanged.

---

## 6. Per-verb design

### 6.1 `dev` & background supervision

Foreground `dev` is the current behavior (spawn target dev processes, color-prefixed interleaved logs, SIGINT tears down). New: `--background`.

`odo/email` gets supervision "for free" because `dev` is `docker-compose up -d` and Docker owns the lifecycle. A generic premo running `next dev` or `tsx --watch` on the host has no such backstop, so premo owns a **generic supervision layer** (net-new vs. odo):

- On `dev --background`: spawn detached in its own **process group**, write `{ pid, pgid, logPath, target, startedAt }` to `.premo-local.json`, redirect stdout/stderr to `.runtime/<target>.log`, print the pid + log path.
- `stop` → read the records, kill by **process group** (so child watchers/servers die too), clear the records.
- `logs [target]` → tail `.runtime/<target>.log` (all targets interleaved if none given).

Implemented in `core/supervise.ts`: the background records (`{ pid, pgid, logPath, … }`) live in `.premo-local.json` via `core/local.ts`, and logs under `.runtime/<target>.log`.

### 6.2 `build`

Affected targets by default (§4); `--all` for everything; `[target]` for one. Each target's build command comes from `targets.<t>.commands.build` → `commands.build` → adapter → not-implemented.

### 6.3 `lint`

**File-granularity** and **auto-fix by default** (the inverse of most tools — deliberate; the tree is in git). Default: compute the changed-file list (§4 baseline), pass it to the target's linter(s) and fix in place. `--dry` → check only, non-zero exit on findings. `--all` → whole tree. No separate `format` verb — fix-by-default subsumes it.

### 6.4 `test`

**Target-granularity** (§2): default runs the suites of affected targets; `--all` runs every suite; `[target]` runs one. (File-level test-impact analysis is explicitly _not_ attempted — "affected target" is the unit.)

### 6.5 `deploy`

Pure-git tracking lifted from `odo/email` (no external state):

- **Per-target deployed ref.** One deployable env → `deployed/<target>`; multiple → `deployed/<env>/<target>`. The env segment only appears when more than one environment is marked `deploy: true` (§15) — the deployable set is derived from the canonical `environments` list, not a separate `deploy.envs`.
- **Change listing.** For each target, `git log <deployed-ref>..<base>` lists undeployed commits; each commit is annotated with the targets it affects via the §4 primitive — so you see exactly what will ship and to which targets.
- **On deploy.** Run the target's deploy command, then advance the ref: checkout `deployed/<…>`, `git merge <base> --ff-only`, tag a version, push branch + tag, return. Fast-forward-only keeps the ref an honest pointer at "the commit currently deployed."

### 6.6 `stop` / `logs`

See §6.1 — they exist to manage `dev --background` and read from the same `.premo-local.json` / `.runtime/` records.

---

## 7. Adapters (the convention tier)

Built-in detectors that supply default verb commands (and enumerate targets) with zero config:

- **xcode** (first; native Apple apps) — detects a root `.xcodeproj`/`.xcworkspace`; one target per project, `premo test` runs the whole scheme (unit + UI). Its `adopt()` hook (see below) runs `xcodebuild -list` once to bake the _facts_ — scheme, bundle id, a pinned default simulator (`xcode.defaultDestination`) — into an `xcode` block, but **not** the `dev`/`build`/`test` commands. When the project exposes **several shared schemes** (the classic dev/prod split), adopt derives an environment per scheme and bakes a per-env `{ scheme, bundleId }` map instead of a single pair (§15), so each environment installs/launches its own bundle. Those are supplied live by the **xcode runner** (`core/runners`): an `xcode` block _implies_ a `{ run: "xcode" }` script for the build verbs, and the runner generates the command at resolve time. So the multi-step recipe (build → install → launch) lives in premo — versioned, upgradeable, never frozen as bash-in-JSON in each repo — while config stays a tiny declarative block (see §3's Script/runner note). Two runtime variables feed the generated command: _which simulator/device to run on_ — resolved per-invocation (the `--device`/`--platform` flag → the pinned default → an interactive picker on a TTY) and injected as `PREMO_XCODE_DEST` — and _which environment_ (§15) — the `--env` flag → the `default` env — which selects the scheme/bundleId pair the rest of the recipe builds, installs, and launches. `dev` builds → boots the sim → installs → launches with streamed logs in the foreground (macOS execs the built `.app`'s binary directly so it's a killable child). A literal command string (or explicit spec) under `commands` overrides the implied runner per verb.
- **workspaces** (matches the reference projects) — reads workspace globs from `package.json` `workspaces` (yarn/npm) or `pnpm-workspace.yaml`; each workspace is a target with `dirs: ["<path>/"]`; verb commands map to the detected package manager's `<script>` when it exists.
- **package.json scripts** (single-package node) — maps verbs to `yarn <script>` / `npm run <script>` when present.
- Future: Cargo, Go, Make passthrough, etc. — each new adapter fills a column of the (verb × project-type) matrix.

`premo adopt` is the **configure tier**: run the best-matching adapter's detection, then _write_ the resolved `commands` + `targets` into `premo.json` so the user can edit a concrete starting point instead of relying on live magic. An adapter may implement an optional `adopt(root)` hook to contribute baked config (the xcode adapter uses this to compile its `xcode` facts block — the build verbs then resolve live through the xcode runner, per §3's Script/runner note — exactly the "configure tier produces concrete output" property of §3). The **skill tier** emits a `SKILL.md` for an agent when detection can't produce a working config.

**Re-adopt is an additive sync, not a regenerate.** Running `premo adopt` on an already-adopted repo folds newly-detected features into the existing `premo.json` without overriding anything the user configured: existing values always win, detection only fills gaps and appends new entries (packages, targets, environments, commands), and ports are assigned only to newly-added serving targets so existing pins survive. Nothing is removed — entries the repo no longer backs are reported as _stale_ rather than deleted (the user's call). It's idempotent: a re-adopt with no repo changes writes nothing. `premo adopt --force` is the escape hatch that regenerates from scratch, discarding manual edits. This makes re-adopt safe to run habitually as a project grows, which is the whole point — you add a package or a deploy script and `premo adopt` notices.

---

## 8. CLI architecture (current → target)

Commander-based TS app (`bin/premo.ts` → `src/cli/registry.ts`), run via `tsx`. What the task-runner reuses vs. adds:

**Reuse (already implemented):**

- `core/project.ts` — load/save/validate `premo.json` (Zod). Extend schema with §5 fields.
- `core/local.ts` — worktree-local `.premo-local.json` state (background process records, last-run xcode destination).
- `core/logger.ts`, `core/env.ts`, command registry, the existing `dev`/`stop` process-spawning.

**Add (net-new):**

- `core/git.ts` — `mergeBase`, `diffNames`, `porcelainStatus`, ref read/advance for deploy.
- `core/affected.ts` — the §4 primitive (files → targets, fan-out, exceptions, `affectedCommand`).
- `core/adapters/` — detector + default-command providers (§7); `adopt` command on top.
- `core/supervise.ts` — detached spawn / process-group kill / log tail (§6.1).
- `core/deploy.ts` — change listing + ref bookkeeping (§6.5).
- New commands: `build`, `test`, `lint`, `deploy`, `logs`, `adopt` (and generalize `dev` with `--background`, `stop` with process-group kill).

---

## 9. P1 — worktree & data-branch

### 9.1 Worktree support

Mostly generic, lifted from `odo/email` (`scripts/tree.ts`):

- `git worktree add` on a feature branch, then **replay the un-committed local state** the project needs to run.
- The expensive bit (`node_modules`) is cloned **copy-on-write** (`cp -Rc` on macOS, `cp -al` on Linux); small files (`.env`) are copied.
- _What_ to carry is the only project-specific part → declared as `worktree.carry` (§5), COW the default strategy for directories.

(odo's per-worktree port-block allocation is its own concern; premo's hash-derived port base already gives deterministic per-project ports, and per-worktree port isolation can layer on later if needed.)

### 9.2 Data-branch — deferred

`odo/email`'s data-branches (per-branch Postgres/Redis/Qdrant volumes, per-branch encryption secrets, port blocks) are deeply tied to having stateful services — meaningless for a static site. premo will **not** ship a generic data-branch built-in. A stateful project opts in via a tier-3 skill / declared plumbing. Its "friendly semantics" (clone semantics, secret handling, lifecycle vs. worktrees) deserve a dedicated design pass and are explicitly out of scope here.

---

## 10. Decisions (locked)

Carried forward from the scaffolder design (still true):

1. **Yarn classic (1.x) + workspaces.**
2. **`premo.json` at project root**, versioned (`"version": "0"`). Worktree-local state in `.premo-local.json` (gitignored).
3. **Node 22 LTS.**
4. **Tiny custom token replacer** for `${VAR}` interpolation in `open`/`shell` (no Handlebars/EJS).
5. **No telemetry, ever.**
6. **Hash-derived default port base** (30000–49999, 100-port blocks), allocated on adopt and exported as `$PORT` to `dev`.
7. **Name: `premo`.** (Latin _premo_, "I press" — you press a button on the remote; also the casual sense of "premium." Free npm name; `premo.sh`.)
8. **Stack: commander + execa + zod + yaml + picocolors; tsx to run; Vitest to test.**

New, from the task-runner reframe:

9. **Fixed, closed verb vocabulary** (§2): `dev build test lint deploy stop logs`. Growing it is a deliberate decision, not a default.
10. **Resolution order is config → adapter → helpful-not-implemented** (§3). An unconfigured project never dead-ends.
11. **Three tiers are a ratchet that all emit the same artifact** (verb→command in `premo.json`). Contribute-back = filling/promoting cells of the (verb × project-type) matrix.
12. **The affected primitive is the keystone** (§4): baseline = `merge-base origin/main` diff + `status --porcelain`; targets declare `dirs`/`affects`/`affectsExcept`; `affectedCommand` is the escape hatch.
13. **Scope granularity is split:** `build`/`test`/`deploy` are target-granular; `lint` is file-granular. `test --all` means all _targets_, not file-level impact analysis.
14. **`lint` auto-fixes by default; `--dry` only checks.** No separate `format` verb.
15. **Deploy is git-ref bookkeeping** (§6.5): `deployed/<target>` refs, ff-only advance + version tag, `git log` for the undeployed change listing. **Single env by default; multiple supported**, and the `<env>` ref segment appears only when more than one env is configured.
16. **premo owns a generic background-supervision layer** — detached process-group spawn + `.premo-local.json` records + logfile + group-kill — because we can't lean on Docker's lifecycle for host processes.
17. **git is assumed.** Affected-detection, deploy, and worktrees all require a git repo.
18. **Data-branches are out of scope** (§9.2); a stateful project opts in via tier-3 plumbing, designed separately.
19. **Every capability is a project-level contract; scaffolding and adapters only populate it.** No feature branches on "is this a scaffolded project." `shell`, `deploy`, `open`, and the verbs all resolve from declared config (`commands`, `shells`, …). `premo new` and future adapters _write_ that config, but a hand-authored `premo.json` is first-class and behaves identically. When tempted to special-case scaffolded vs. adopted, define the contract instead and have scaffolding fulfill it.

Monorepo model (§13, supersedes the single-`targets` parts of 12/13/15 above):

20. **Two axes: `packages` and `targets`.** `packages` are the unit of `build`/`test`/`lint` (one per directory); `targets` are the unit of `dev`/`deploy` (a runnable/shippable of 1+ packages). The field formerly named `targets` becomes `packages`; `targets` is reassigned. Config is two top-level arrays of named objects, written **materialized-full** by `adopt` with omittable (backfilled) fields.
21. **Recursive depth-1 package detection.** Discover members by scanning immediate child dirs where an adapter matches; **≥2 ⇒ monorepo**, polyglot (each member keeps its own child adapter), keyed by **directory name**. The monorepo adapter outranks `cli`/`node-scripts`, so a root `bin` (and root aggregator scripts) no longer hijack a monorepo into the `cli` adapter.
22. **No verb guessing.** A package contributes only the verbs it actually defines; a missing `test`/`build`/`lint` reports honestly rather than being mapped onto a near-named script. Non-standard script names are an upstream-repo cleanup, not premo's to paper over.
23. **Targets auto-seed 1:1 from packages; composites are authored.** Every package with a `dev` seeds a same-named target; every package with a `deploy:<dirname>` (or own `deploy`) script gets a deploy. Only multi-package targets (compose stacks) are hand/AI-authored. **`compose` is first-class.** `default` marks the bare-`premo dev` target.
24. **`dev` run method is derived** (`compose` → `command` → member packages' dev), **ports moved onto targets** ($PORT injected), and **`deploy` is per-target** with bare `premo deploy` an interactive multi-select pre-checked to the pending set (`--yes` non-interactive, `--force` to redeploy).
25. **premo detects, but does not infer topology.** Packages, 1:1 targets, and the `deploy:<name>` convention auto-detect; which compose service is infra / how services wire is confirmed by AI/human. That boundary keeps the config declarative without a DSL.

`share` (§14, supersedes nothing — purely additive):

26. **`share` is a utility command, not a sixth core verb.** It exposes a running target's port on a public URL; it touches none of the affected/packages/deploy machinery the five verbs share, so it sits with `open`/`shell`/`ports` and the closed verb vocabulary (decision 9) stays closed. It is **target-axis** — `share [target]` mirrors `dev [target]`, funneling the target's `ports.base`.
27. **Tunnel backends are a provider registry** (`core/share/`), the same registered-strategy shape as `core/runners`: a `ShareProvider` knows if it's available, the foreground command to run for a port, and how to report the public URL. **tailscale (funnel) is first;** ngrok/cloudflared slot in by registering. Provider choice is `--via` → `share.provider` → `"tailscale"`.
28. **premo owns the tunnel's lifecycle, not the backend's `--bg`.** Every provider runs its tunnel in the **foreground** (`tailscale funnel <port>`, not `--bg`) so premo's own supervision (decision 16) governs it: foreground tears down on Ctrl-C, `--background` detaches via `spawnDetached`, and `stop`/`logs` manage it uniformly across providers. Deferring to each tool's own background flag would hide the tunnel from `stop`/`logs`.

Environments (§15, supersedes the `deploy.envs` half of decision 15):

29. **Environments are a third, orthogonal axis** (§15) — a project-wide _facet_ (dev/prod/…) selected with a global `--env`, not packages and not targets, resolved at run time so it never multiplies the target list. One canonical `environments` list is the single source of truth: `deploy: true` marks a deploy destination (the old `deploy.envs` is derived from it and migrated at load), `default` is the omitted-`--env` env, and an absent block means one implicit env (today's behavior). The active env is exported as `PREMO_ENV`. xcode units carry a per-env `{ scheme, bundleId }` map (a bare `scheme`/`bundleId` is the one-env case); only `dev`/`deploy` consult the env so far — `build`/`test`/`lint` stay env-agnostic.

---

## 11. The scaffolder (a separate project)

premo grew out of a project _scaffolder_ — composing a typed monorepo from reusable components ("strands"), with templates, compose fragments, integration skills, and vendored snippets. That capability now lives in its **own project** (which keeps the `strand` name and the "made of strands" metaphor). The relationship is one-way: the scaffolder _produces_ a repo that already has a good `premo.json`; premo is what you use every day afterward, regardless of how the repo was born. The connective tissue is the **promotion ratchet** of §3 (skill → configure → convention) and the shared `premo.json` contract.

---

## 12. Phased roadmap

- **v0.1 (the task-runner spine — shipped):**
  - `core/git.ts` + `core/affected.ts` (the §4 keystone).
  - the `premo.json` schema (`commands`, `targets`, `changeBase`, `affectedCommand`).
  - `build`, `test` (affected-aware), `lint` (whole-tree, auto-fix; per-file deferred).
  - `dev --background` + generic supervision; `stop` (group-kill) + `logs`.
  - yarn-workspaces + node-scripts adapters; `premo adopt` (auto-adopt on first touch) + helpful not-implemented messages; global port registry; `doctor` as the read-only wiring surface; project-aware grouped help; `shells` contract.
- **v0.2 (shipped):** `deploy` — `YYYY.MM.DD.N` version from release tags, per-target `deployed/<target>` ff-only advance + `release/<target>/<version>` tag pushed to origin, change listing, confirmation, single-env default with multi-env spec'd.
- **v0.2.x (shipped):** the `xcode` adapter — detect `.xcodeproj`/`.xcworkspace`, build/test/run on a simulator or device, interactive destination picker with a remembered last device, baked commands via `adopt`.
- **v0.2.x (shipped):** the **skill tier** — `premo skill` emits a `SKILL.md` (a self-contained task file) that teaches a coding agent how to finish wiring an unhandled stack, surfaced from the not-implemented and no-adapter paths. Plus the **agent-facing surface**: `--json` on `doctor`/`adopt`/`ports`/`skill`, and a repo-root `AGENTS.md`.
- **v0.3:** worktree support (§9.1); per-file `lint`; a static-site deploy adapter (auto-discover the `deploy/deploy.sh` contract).
- **Later:** promotion tooling (skill → configure → convention); npm/pnpm-workspace + more adapters; data-branch design pass.

### Testing implications

Unit tests over **fixture repos that represent adopted projects** — a yarn-workspaces monorepo, a single-package node app, a minimal Xcode project — asserting adapter detection, affected-target resolution against scripted git states, `lint --dry` on a changed-file set, and `deploy` ref bookkeeping against a throwaway git repo.

---

## 13. Monorepo model — packages & targets

> **Supersedes the single-`targets` model in §2, §4, §5, §6.2–6.5, and §7** for multi-unit repos. Validated against `~/git/odo/email`. The field formerly called `targets` (dirs + verb commands) is **renamed `packages`**; `targets` is **reassigned** to the run/deploy axis below. A single-package repo still works: it has one package, and one auto-seeded target equal to it, so the two axes coincide invisibly.

### 13.1 Two axes

A non-trivial repo has two kinds of unit, at different granularities:

- **Packages** — the unit of `build` / `test` / `lint`. One per source directory. The "what code exists" map; the affected graph (§4) is computed here.
- **Targets** — the unit of `dev` / `deploy`. A _runnable/shippable_ composed of **one or more packages** (+ infra). Does **not** map 1:1 to packages.

| verb                | axis         | unit                                            |
| ------------------- | ------------ | ----------------------------------------------- |
| build / test / lint | **packages** | a directory of code                             |
| dev / deploy        | **targets**  | a runnable/shippable composition of 1+ packages |

Conflating them is what made `dev` awkward: build/test/lint decompose per directory, but "run the app" and "ship the service" are compositions — a compose stack spanning five packages; a deploy that may bundle a package with its `shared` lib. The split is principled: **inner-loop verbs (build/test/lint) are per-package; outer-loop verbs (dev/deploy) are per-target.**

### 13.2 Detecting packages — recursive, depth-1

Replaces the workspaces-only detection of §7 with a discovery that also handles **manual** monorepos (no `workspaces` field), which is the common product-monorepo shape.

Adapter precedence: `xcode(root) → workspaces(declared) → monorepo(discovered) → cli → node-scripts`.

- **monorepo(discovered):** scan the repo's **immediate child directories only (depth 1)**; keep each child where `detectAdapter(child) ≠ null`. If **≥2** members are found, the repo is a monorepo.
- Each member resolves its **own child adapter** via the normal resolution — so the monorepo is **polyglot** (N node packages + an `xcode` member + a `cli`, all in one repo). A native-app member bakes its own `xcode` block (scheme, bundle id, default destination — paths relative to the member dir) onto its package at adopt, so `dev`/`build`/`test` on it are reproducible; destination resolution picks the named package/target's block. Even **before** adopt — e.g. a native app added to an already-adopted monorepo — detection surfaces a _best-effort_ block (project/workspace path + scheme guessed as the basename) so destination resolution still engages: `build`/`test` and a TTY-interactive `dev` (or `dev --device`) work, the bundle id is read live from build settings, and adopt later pins the default destination for non-interactive (`--background`) runs.
- Packages are **keyed by directory name**, not package name. Required: in `odo/email`, `frontend`'s package is named `email` and `marketing`'s is named `odo`; directory names are the stable, collision-free identifiers.
- When the monorepo adapter wins, the **root's own `bin` and aggregator scripts are ignored** — this is what stops a dev-tool `bin` at the root (odo's `bin/odo.ts`) from hijacking detection into the `cli` adapter and mapping `dev` to "run the CLI."

Each package's `build`/`test`/`lint` come from its child adapter (its own `package.json` scripts, or `xcodebuild` for an xcode member). A package contributes **only the verbs it actually has** — premo must **not** guess (e.g. it must not map a missing `test` onto a `test:stores`); a package with no `test` reports "no test for this package," which is the honest signal that the _repo_ should standardize its script names.

### 13.3 Detecting targets — auto-seed, then curate

- **Auto-seed (1:1):** every package with a detected `dev` script seeds a same-named target whose run method is that package's dev. Every package with a deploy mapping (a root `deploy:<dirname>` script, or its own `deploy` script) gets a `deploy` on its target. So in practice most targets _are_ 1:1 with a package and need no authoring.
- **Curate (1:many):** the genuinely composite targets — a `compose` stack spanning several packages — are declared by hand/AI. **`compose` is first-class** (premo knows docker compose as a substrate, the way it knows xcode).
- **`default`** marks the target that bare `premo dev` brings up.

This is the gradient: simple repos get targets for free; complex repos author only the compositions.

### 13.4 Config shape

Top-level, the manifest carries two arrays of objects, each identified by `name`. `premo adopt` writes them **materialized-full** (every detected package and seeded target is written out, so you can see and edit exactly what premo found); any field equal to detection may be deleted and premo backfills it at load.

```
package = { name, dir?, commands?: { build?, test?, lint? }, deps?: [pkgName…] }
target  = { name, packages?: [pkgName…], compose?, command?, deploy?, ports?: { base, block? }, default? }
```

- A `package` and a `target` may share a name (separate namespaces) — natural, since the `backend` target runs/deploys the `backend` package.
- **`deps`** on a package are the affected fan-out edges of §4 (e.g. `shared` → its consumers), now expressed package-to-package.
- **`packages`** on a target is what it comprises — it drives "pending deploy" / affected for the target (the frontend target redeploys when `shared` changes).
- **`ports`** moved onto the **target** (each standalone runnable owns its port; a `compose` target's ports live in the compose file). The base is injected as `$PORT`; Vite/Next get `--port` forwarding as today.

### 13.5 Resolution per verb

- **`build` / `test` / `lint`** → **packages**, affected-aware (§4). `premo build [package]` for one; default = affected; `--all` = every package.
- **`dev`** → **targets**. `premo dev` runs the `default` target; `premo dev <target>` runs one. A target's run method is **derived**, in priority order:
  1. `compose` present → `docker compose -f <file> up` (supervised by §6.1, `$PORT`/env injected);
  2. `command` present → run it (the leaf escape hatch);
  3. else → run the dev scripts of its member `packages` that have one.
- **`deploy`** → **targets** (§6.5 machinery, now keyed by target; the target's member packages drive the undeployed-commit diff against `deployed/<target>`). `premo deploy <target>` ships one directly; bare `premo deploy` presents an **interactive multi-select pre-checked to the pending set** (targets with member-package changes since their deploy ref), with `--yes` for the non-interactive path and `--force` to redeploy an up-to-date target.

### 13.6 Worked example — `odo/email`

The materialized `premo.json` (`adopt` writes this; everything except the `stack` target auto-detects):

```jsonc
{
  "name": "odo-email",
  "packages": [
    { "name": "backend" },
    { "name": "frontend" },
    { "name": "marketing" },
    { "name": "browser" },
    { "name": "shared" },
    { "name": "cli" },
    { "name": "react-email" },
    { "name": "training" },
    { "name": "ios" },
  ],
  "targets": [
    { "name": "stack", "compose": "docker-compose.yml", "default": true },
    {
      "name": "frontend",
      "packages": ["frontend", "shared"],
      "deploy": "yarn deploy:frontend",
      "ports": { "base": 3000 },
    },
    {
      "name": "backend",
      "packages": ["backend", "shared"],
      "deploy": "yarn deploy:backend",
      "ports": { "base": 3010 },
    },
    {
      "name": "marketing",
      "packages": ["marketing"],
      "deploy": "yarn deploy:marketing",
      "ports": { "base": 3001 },
    },
    { "name": "browser", "packages": ["browser"], "deploy": "yarn deploy:browser" },
    { "name": "react-email", "packages": ["react-email"] },
    { "name": "ios", "packages": ["ios"] },
  ],
}
```

Reading it: `premo dev` → the `stack` (compose: `db+redis+qdrant+backend+worker+frontend+react-email`). `premo dev frontend` → frontend's standalone Vite on `:3000` (`shared` rides along only for affected/deploy). `premo deploy` → a picker over `{frontend, backend, marketing, browser}` pre-checked to pending; `premo deploy marketing` ships it directly. `premo build`/`test`/`lint [package]` → packages, affected-aware. **The only hand/AI-authored line is the `stack` target** — the proof the config stays declarative (premo acts on nouns it understands) without becoming either a programming language or a pointless wrapper around scripts. You then prune any auto-seeded standalone target that only ever runs inside `stack` (e.g. `backend`, `react-email`).

### 13.7 Honest scope boundary

premo detects packages, seeds 1:1 targets, and maps the `deploy:<name>` convention — but it does **not** try to auto-infer a repo's _topology_ (which compose service is infra, who wires to whom). That wiring (the composite `dev` targets) is confirmed by AI/human. This is the line that keeps premo from needing either magic or a config DSL, and it's exactly where "reasonable to require AI to wire up a complex repo" lands.

---

## 14. `share` — public tunnels (a utility command)

> Additive. Does not touch the affected primitive (§4), packages/targets resolution (§13), or deploy refs (§6.5). It is the public-URL sibling of `open`: where `open` launches `http://localhost:${PORT}` in your browser, `share` exposes that same port on the internet.

### 14.1 Shape

```
share [target] [--via <provider>] [--background]
```

- **Target-axis** (like `dev`/`deploy`), but with a **share-specific default**, because `share` exposes _one_ port where `dev` brings up a whole stack. With no `[target]` it selects among the **serving** targets (those with an allocated `ports.base` — the set `assignTargetPorts` populates): honor an explicit `default` if it serves, else the lone serving target, else ask which. So a single-app repo shares its port with zero args (like `open`), and a compose-stack repo whose default target owns no single premo-known port still resolves to the one frontend that does. No serving target ⇒ a helpful message (run `dev`/`adopt`, or set `ports` on a target).
- **Tunnel-only.** v1 assumes something is (or will be) listening on the port — run `premo dev` alongside. `share` does one thing: expose a port. Bringing `dev` up in the same command is a possible later `--with-dev`, deliberately deferred (it would couple `share` to the dev supervisor).
- **Lifecycle = the §6.1 supervision layer.** Foreground by default — the tunnel runs over the inherited TTY and Ctrl-C drops it (the [premo dev lifecycle] property: foreground premo tears down what it started). `--background` detaches via `spawnDetached`, recorded in `.premo-local.json` as `share-<target>`, so `premo logs` tails it and `premo stop` ends it — the same records `dev --background` uses.

### 14.2 The provider registry

`core/share/` mirrors `core/runners/` — a registered-strategy list, looked up by name:

```ts
interface ShareProvider {
  name: string; // "tailscale" | "ngrok" | "cloudflared"
  isAvailable(): Promise<{ ok: boolean; reason?: string }>; // installed + authed (+ funnel-enabled)
  command(port: number): string; // the FOREGROUND tunnel command premo supervises
  publicUrl(port: number): Promise<string | null>; // the URL to surface (best-effort)
}
```

`isAvailable` carries a `reason` so an unavailable provider produces the "helpful not-implemented" message (§3), not a raw CLI error. `command` returns a shell string premo runs and supervises — identical to how a runner returns a command, so the supervisor plugs in unchanged. `publicUrl` is the one genuinely per-provider seam: tailscale derives it from the node's MagicDNS name; ngrok would read it from ngrok's local API.

Provider choice: `--via` flag → `share.provider` in `premo.json` → `"tailscale"` default.

### 14.3 The tailscale provider (first)

"Public so others can access it" ⇒ **`tailscale funnel`** (not `tailscale serve`, which is tailnet-private). Specifics that shape the provider:

- **Command:** `tailscale funnel <port>` — the **foreground** form (the bare `<target>` form in `tailscale funnel --help`). Premo does **not** pass `--bg`; premo's own `--background` does the detaching, so `stop`/`logs` stay authoritative (decision 28).
- **Public URL:** funnel terminates TLS and serves on `https://<node>.<tailnet>.ts.net` (default public port 443 ⇒ no port in the URL). `publicUrl` reads `tailscale status --json` → `Self.DNSName`. If `openUrl` declares a path, premo appends it so collaborators land on the right page.
- **Constraints surfaced by `isAvailable`:** tailscale installed + logged in; and Funnel must be enabled in the tailnet policy with HTTPS certs (MagicDNS). A missing prerequisite is reported as the actionable next step, not a stack trace.

### 14.4 Config

A small, optional block — provider only, for now:

```jsonc
{
  "share": { "provider": "tailscale" }, // omit ⇒ tailscale; `--via` overrides per-run
}
```

Per-target provider overrides can layer on later (the way commands/ports already sit on targets) if a repo ever needs to share different targets through different backends; not needed for v1.

---

## 15. Environments — the facet axis

> Additive, and a **completion** rather than a new concept: `deploy.envs` (§6.5) was already "the project's environments, but only visible to `deploy`." §15 promotes that list to a first-class, project-wide axis the **other verbs** see too, and folds `deploy.envs` into it.

### 15.1 The third thing

§13 established two axes — **packages** (the `build`/`test`/`lint` unit) and **targets** (the `dev`/`deploy` unit). An **environment** is neither: it's an orthogonal _facet_ that, when selected, swaps each unit to its env-specific configuration. dev vs prod is the canonical case — an iOS app with `Chess Dev` / `Chess Prod` schemes, a backend pointed at a dev vs prod database, a deploy that ships to the prod ref.

The alternative — flattening dev/prod into the target list as `ios-dev` / `ios-prod` — is the §13.1 mistake again: in a monorepo it's a cartesian product (every package × every env) no one can read. So the environment is resolved **at run time**, the same shape as device selection: one project-wide switch, never a multiplied noun.

| axis             | unit                            | verbs                 | selection        |
| ---------------- | ------------------------------- | --------------------- | ---------------- |
| **packages**     | a directory of code             | build / test / lint   | `[package]` arg  |
| **targets**      | a runnable/shippable of 1+ pkgs | dev / deploy          | `[target]` arg   |
| **environments** | a facet of the whole project    | dev / deploy (so far) | `--env` (global) |

### 15.2 Canonical list, deploy is a flag

The project declares one list. Each environment may mark itself a deploy destination; the deploy env set (§6.5) is **derived** from it, so there is no separate `deploy.envs`:

```jsonc
"environments": [
  { "name": "dev",  "default": true },  // bare `premo dev` / non-deploy verbs
  { "name": "prod", "deploy": true },   // deployable; `premo dev --env prod` still works
]
```

- **`default`** is the env used when `--env` is omitted (and the implicit env when the field is absent entirely — a project with no `environments` block behaves exactly as today, as a single unnamed env).
- **`deploy: true`** is what the §6.5 ref-segment rule counts: one deployable env → `deployed/<target>`; multiple → `deployed/<env>/<target>`.
- **Migration:** a legacy `deploy.envs: [...]` is read at load and rewritten to `environments` (each listed env gets `deploy: true`; a `default` is backfilled), per the §13.4 backfill philosophy. `deploy.envs` is no longer written.

### 15.3 Selection is one project-wide switch

`premo dev --env prod` (alias `-e`) flips **every unit that defines that env** to its prod configuration; units with no env-specific config are unaffected. This is what keeps the target list flat — the dev/prod dimension never materializes as targets; it's `target × environment`, resolved per-invocation. The active env is exported as **`PREMO_ENV`** (the seam user scripts and the runners read), mirroring how device choice reaches the command via `PREMO_XCODE_DEST`. An env named on the CLI that a unit doesn't define falls back to the unit's `default`-env config (a backend with no per-env split just runs the same everywhere); an xcode unit with a per-env map but no entry for the selected env errors rather than guessing a scheme.

### 15.4 Per-env xcode facts

A scheme is not the only env-varying fact: premo bakes `bundleId` from a scheme's build settings and uses it to **install and launch** the right app (`PREMO_XCODE_BUNDLE_ID`), and dev/prod almost always differ there (`do.odo.chess.dev` vs `do.odo.chess`). So when a project has several schemes the `xcode` block carries a per-env map, not a bare pair:

```jsonc
"xcode": {
  "project": "ios/Chess.xcodeproj",
  "defaultDestination": { "platform": "ios-device" },
  "environments": {
    "dev":  { "scheme": "Chess Dev",  "bundleId": "do.odo.chess.dev" },
    "prod": { "scheme": "Chess Prod", "bundleId": "do.odo.chess" },
  },
}
```

A bare top-level `scheme` / `bundleId` remains valid and means the single-`default`-env case (normalized to a one-entry map at load), so every existing single-scheme repo keeps validating and running unchanged.

### 15.5 Scope boundary (what §15 is **not**, yet)

Only `dev` and `deploy` consult the env today. `build`/`test`/`lint` stay env-agnostic (a build is a build; the affected graph doesn't fork per env). Two natural follow-ons are deliberately deferred: an env selecting `.env.<env>` (the `envFile` ↔ environment tie-in), and per-env `defaultDestination`. Both slot onto this axis once it exists, without reshaping it.

## Appendix A — naming

**premo** — you _press_ a button on the remote (Latin _premo_, "I press") to make any project do something; it's also the casual sense of "premium." The free npm name and `premo.sh` are the homes. The companion scaffolder keeps the **strand** name (a project is _made of strands_).

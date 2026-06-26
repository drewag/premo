# Proposal: data instances (a `data` axis for premo)

Status: **proposal, consumer-driven.** Written from the orchestrator's side (the
first consumer) so the contract is pinned down before premo implements it. Refine
freely — the parts that matter to the consumer are §1–§3; §4–§6 are
implementation suggestions premo owns.

## 0. Why

The orchestrator stands up **on-demand PR previews**: build + serve the code from
a pull request's worktree, reachable by URL, idle-reaped (see the orchestrator's
`docs/pr-previews.md`). A preview is conceptually:

```
preview = (worktree, port-base, data)
```

- **worktree** — orchestrator creates/destroys it (a detached git worktree per PR).
- **port-base** — orchestrator allocates it; premo lays its targets out from it.
  (Separate proposal: `premo dev --port-base N`. Same shape as this one.)
- **data** — the mutable state the running stack sees.

`premo dev` already brings up the whole stack, and that's the right convention —
we are **not** asking for partial-stack previews. The variability is entirely in
**data**: a fresh full-stack boot has none of the existing data a reviewer
actually wants to test against (the email project's synced mailboxes, a chess
project's games, etc.).

So the question premo needs to answer is: **how does a consumer give a `premo
dev` run an isolated, controlled data set — created, cloned, and torn down often,
without committing anything each time?**

### The boundary we're enforcing

The orchestrator must **never read or write premo's config** (premo.json). It only
ever calls `premo …` and consumes machine-readable output. Where a project's data
lives is project-specific and belongs in premo's config; the orchestrator stays on
the consumer side of `premo data …`.

### Why not config, why not the orchestrator

- Data **instances** are transient — spun up and torn down per preview, per
  experiment. They must **not** require a commit (so they're not in premo.json).
  They belong in premo's _host-global transient_ state (`$PREMO_HOME/data/…`),
  keyed by the repo's main worktree and tracked by premo — so a handle minted in
  one worktree is usable from every other worktree of the repo (§6 Q3/Q4).
- What _is_ config is **how data is defined for this project** — wired commands
  (consistent with how `dev`/`build`/etc. are wired). premo.json says _how_ to
  create/clone/delete a data instance; premo tracks the instances themselves.

---

## 1. What the consumer needs (the contract)

A small command surface built around an **opaque handle**. The orchestrator
composes these without any project-specific knowledge.

### 1.1 The `data` subcommand namespace

`data` is premo's **first subcommand group**, and that is deliberate. The five core
verbs (`dev`/`build`/`test`/`lint`/`deploy`) are a closed set; promoting
`create`/`clone`/`list`/… to top-level verbs would blow that set open with five
generic words. Nesting them under a `data` **resource noun** is exactly what keeps
the verb vocabulary closed — so `data` joins `doctor`/`adopt`/`ports`/… as a
utility surface, but as the first one shaped `premo <noun> <action>`:

```sh
premo data create            [--name <label>] --json
# → mint a FRESH isolated instance. Prints the new handle.

premo data clone  <handle>   [--name <label>] --json
# → mint a COPY of <handle> — or of `live`, the project's working data. This is
#   "test against existing data" and how a golden dataset is bootstrapped (§5).
#   (Replaces the old `create --from`.)

premo data delete <handle>   --json
# → tear down the instance. Idempotent (unknown/already-gone handle ⇒ exit 0).

premo data list              --json
# → all known instances + metadata.
```

`create` and `clone` are the two points of one primitive — `mint(source?)`:
`create` copies from nothing, `clone` copies an existing instance (or `live`). Both
produce an instance that **persists until `delete`** — premo has no reaper, so there
is **no ephemeral/retained distinction** (a consumer that wants throwaway instances
just deletes the ones it's done with; see §2). `clone`/`delete` take a required
positional `<handle>`; `create` takes none, mapping each 1:1 to a wired command (§3.1).

### 1.2 Running against an instance

```sh
premo dev --data <handle> [--port-base <N>]
# → bring up the full stack pointed at that data instance.
```

premo injects the instance into the run the same way it injects `PORT` today: the
project's wired `dev` commands receive a premo-set env var — **`PREMO_DATA_HANDLE`**
(the opaque token) — and turn it into whatever the stack needs
(`DATABASE_URL=…/premo_$PREMO_DATA_HANDLE`, a data path, a volume name). The
directory adapter (§3.2) additionally injects `PREMO_DATA_DIR`. The consumer does
not need to know which; it only passes the handle. `--data` and `--port-base` are
orthogonal; omitting `--data` ⇒ `premo dev` behaves exactly as today (additive).

### 1.3 Handle semantics

- A **handle** is an opaque, stable string the consumer stores and passes back
  (`create`/`clone` → handle → `dev --data` / `delete`). The orchestrator treats it
  as a token; only premo (via the repo's scripts or an adapter) knows it maps to a
  path / db / volume.
- Every handle is minted by **`create` or `clone`** — the only commands that create
  instances.
- `delete` is idempotent (deleting an unknown/already-gone handle succeeds quietly
  — teardown must never wedge a reaper).
- Anywhere a handle is taken (`dev --data`, `clone`, `delete`), a human **`--name`**
  label is accepted too, as a convenience. Handles are unique and win; a name
  matching several instances is an error (use a handle). The handle stays the stable
  token a programmatic consumer stores and passes back — names are for humans.

### 1.4 `--json` shapes (what the consumer parses)

```jsonc
// premo data create|clone --json
{ "handle": "d_4f2a9c", "name": "pr-123", "from": "d_golden", "createdAt": "..." }

// premo data list --json
{
  "instances": [
    { "handle": "d_4f2a9c", "name": "pr-123", "from": "d_golden", "createdAt": "..." },
    { "handle": "d_golden", "name": "golden", "from": "live",     "createdAt": "..." }
  ]
}
```

The only fields the orchestrator strictly needs: `handle` (the token it stores and
passes back) and `name` (to recognize a golden it minted). `from` is lineage; the
rest is display. Which instance is "the default to clone" and which are throwaway
previews is the **consumer's** bookkeeping (§1.6, §2) — premo just lists them.

### 1.5 The lifecycle the consumer runs

Per preview, end to end:

```sh
# stand up (data choice resolved by the consumer — see §1.6)
H=$(premo data clone d_golden --name pr-123 --json | jq -r .handle)
premo dev --data "$H" --port-base 48760      # detached, supervised by orchestrator

# … reviewer uses the preview …

# reap (idle / PR merged|closed)
premo data delete "$H"
```

If `--data` is omitted, `premo dev` behaves exactly as today (whatever default
data the project's dev already uses) — this proposal is purely additive.

### 1.6 Choosing the data (the consumer's policy, not premo's)

The data choice is **not deterministically predictable**, so the orchestrator
resolves it at review time, layered:

1. **default** — clone the instance the consumer treats as golden (it minted/named
   it), found in `data list` by `name`.
2. **PR hint** — the coding agent _may_ suggest one in the PR (failable, not
   authoritative).
3. **preview-page picker** — the human picks before stand-up, pre-selected to the
   hint or default. The picker is just `data list` + "fresh."

premo doesn't need to know about any of this — it just needs `list` (to populate
the picker) and `create` / `clone` (to act on the choice). "Which one is the
default" lives entirely on the consumer side.

---

## 2. The model: instances, nothing else

An **instance** is a concrete data set with an opaque handle. That's the whole
model — premo has no reaper and no lifecycle policy, so there is **no ephemeral-vs-
reference category**. Every instance persists until something calls `delete`.

- **create / clone** — `create` makes a fresh one; `clone` copies an existing
  instance (or `live`, the project's working data).

"Test against real-ish data" = `clone <handle>` (or `clone live`); "fresh" =
`create`. "A golden set" is just an instance someone named and chose not to delete;
"a throwaway preview" is one the consumer deletes when it's done. **The
reference/ephemeral split is the consumer's bookkeeping, not premo's** — which is
why it never appears in premo's model or `--json`.

---

## 3. The two contracts

This proposal is really two contracts: **what a repo must implement** to support the
axis (§3.1), and **the directory adapter premo ships** so the common shape needs
zero scripts (§3.2). Same three tiers as the verbs (config → adapter →
not-implemented). §3.3 is the extension seam for future substrates; §3.4 is where
config and instance-tracking live.

### 3.1 Contract A — what a repo implements (the handle contract)

The base contract makes **no assumption about the substrate**. premo owns exactly
one thing — the **handle** (an opaque token) and the registry that maps it to
metadata. The repo owns _all_ physical state, addressed entirely by that handle.

A repo opts in by wiring a `data` block in `premo.json`:

```jsonc
{
  "data": {
    "create": "scripts/data-create.sh", // required
    "delete": "scripts/data-delete.sh", // required
    "clone": "scripts/data-clone.sh", // optional (the dir adapter supplies it, §3.2)
  },
}
```

premo runs each script with **cwd = project root** and the normal env layering
(DESIGN.md §5), plus the injected vars below. The script is a **pure function of the
handle** — it returns nothing; premo replays the handle on every later call and the
script re-derives the resource from it.

| script   | premo injects                          | the repo must…                                              | premo reads |
| -------- | -------------------------------------- | ----------------------------------------------------------- | ----------- |
| `create` | `PREMO_DATA_HANDLE`                    | provision a fresh isolated dataset **keyed by the handle**  | exit code   |
| `clone`  | `PREMO_DATA_HANDLE`, `PREMO_DATA_FROM` | copy the `FROM` instance into a new one keyed by the handle | exit code   |
| `delete` | `PREMO_DATA_HANDLE`                    | drop everything keyed by the handle                         | exit 0      |

And the **consumer half**: `premo dev --data <handle>` injects `PREMO_DATA_HANDLE`
into the dev run env (exactly the way `PORT` is injected). The repo's `dev`/env
wiring turns it into a connection. **A repo whose `dev` ignores `PREMO_DATA_HANDLE`
does not support the axis** — it just has orphaned scripts.

Worked example (Postgres, deterministic naming):

```sh
# scripts/data-create.sh   →  createdb "premo_$PREMO_DATA_HANDLE"
# scripts/data-clone.sh    →  createdb -T "premo_$PREMO_DATA_FROM" "premo_$PREMO_DATA_HANDLE"
# scripts/data-delete.sh   →  dropdb --if-exists "premo_$PREMO_DATA_HANDLE"
# dev reads:  DATABASE_URL=postgres://localhost/premo_$PREMO_DATA_HANDLE
```

**Invariants the repo must uphold** (premo assumes them, can't enforce them):

1. **Namespace by handle.** Everything an instance touches is keyed by its immutable
   handle, so distinct handles never share mutable state. _That_ is where isolation
   comes from — premo runs two previews concurrently against two handles.
2. **Deterministic derivation.** The resource is reconstructible from the handle
   alone; the script stores nothing of its own (premo is the only registry). For a
   substrate that _assigns_ an id premo can't re-derive, see §3.3.
3. **Idempotent `delete`.** Unknown/already-gone handle ⇒ exit 0; the consumer's
   reaper (premo has none of its own) must never wedge.
4. **Side-effect safety.** A clone of real-ish data is a loaded gun (it could send
   email, charge cards, hit webhooks). The repo's `create`/`clone` and its `--data`
   dev env must default external integrations to **stubbed/off** — capture _local_
   state only (the `odo/email` "local files, no live IMAP" model).

**Minimal vs full.** `create` + `delete` wired, and `dev` reading
`PREMO_DATA_HANDLE`, is the whole floor — fresh-per-preview + reap. Add `clone` to
copy an instance (or `live`) — the basis of golden datasets / "test against
real-ish data."

### 3.2 Contract B — the directory adapter premo ships

Most repos shouldn't hand-roll any of §3.1. For the common shape — **a directory of
files (+ an optional sqlite db)**, the `odo/email` model: external state synced into
local files an agent reads — premo ships a built-in `data` adapter. Because _premo_
owns the physical realization (a directory at a premo-chosen, handle-derived path),
it supplies all four actions with **zero scripts**, and can do things the opaque
contract can't:

- injects `PREMO_DATA_DIR` (the instance's directory) on top of `PREMO_DATA_HANDLE`,
  and maps it onto the app's native var via `data.env` (e.g. `DATA_DIR`) so the app
  needs no change;
- **`clone`** = a copy-on-write directory copy (APFS `cp -c` / `clonefile`;
  `cp --reflink=auto` on Linux), falling back to a plain copy — so cloning a large
  instance is near-instant, which matters because previews clone per stand-up;
- **`delete`** = `rm -rf` the directory;
- **zero `data` block** required — detection alone wires it.

A repo on this adapter owes only that its run reads the data location — and usually
even that is free, because `data.env` maps `PREMO_DATA_DIR` onto the var the app
**already** reads (`DATA_DIR`, a sqlite `DATABASE_URL`, …). If a fresh `create`
needs seeding, the app does it on boot (migrations). Side-effect safety (§3.1
invariant 4) is still the repo's job.

#### `link` — a handle for a directory premo doesn't own

`premo data link <path>` registers a handle whose instance directory **is** an
existing directory you point at (the path is resolved against the cwd and stored
absolute in the registry's `path` field), instead of one premo creates under its
home. Use it to expose a dataset that already lives somewhere — a large shared
corpus, a mounted volume, a hand-curated fixture — to `dev --data <handle>` without
copying it in.

Because premo doesn't own that directory, the lifecycle is asymmetric:

- **`dev --data <handle>`** points `PREMO_DATA_DIR` at the linked path, exactly like
  a managed instance — the consumer never knows the difference (the handle is still
  the only reference).
- **`clone <linked-handle>`** copies the external directory **into** a new
  premo-managed instance (CoW) — the natural way to snapshot an external dataset
  into a managed golden.
- **`delete <linked-handle>`** only **de-registers** the handle. premo never runs
  teardown (built-in `rm` _or_ a wired `delete`) against a path it didn't create —
  the directory and its contents are left untouched.

Absolute paths are machine-specific, so a link lives in the (machine-local,
gitignored) registry, never in committed `premo.json` — consistent with instances
being transient registry state, not config (§3.4).

### 3.3 Extension seam — future adapters & non-deterministic substrates

The adapter interface is `{ create, clone, delete }` over an opaque handle; the
directory adapter is just the first. Others slot in by registering the same shape —
a Postgres template-db adapter (`createdb -T`), a Docker-volume adapter, a
ZFS/btrfs snapshot-backed adapter, a cloud-tenant adapter. **Document this interface
thoroughly when we add the next one** — it is the data-axis analog of `core/runners`
/ `core/share`.

The one case the base contract can't express: a substrate whose `create` **assigns**
an id the repo can't choose or re-derive from the handle (a cloud API returning a
generated ARN/UUID). Reconstructing the resource on a later `delete` then needs
`handle → assigned-id` stored _somewhere_ — and it must be premo, or the repo is
forced back into keeping its own sidecar registry (the exact thing §3.1 invariant 2
forbids). Reserved escape hatch: `create` may print a small descriptor on stdout
that premo stores verbatim against the handle and replays as `PREMO_DATA_REF` on
every later call. **Not in v1** — the deterministic contract (§3.1) is simpler and
covers files+sqlite and any name-it-yourself substrate. This is the documented seam
for the day an id-assigning adapter needs it.

### 3.4 Where config and instances live

- **`premo.json` (committed)** — wires the `data` scripts (§3.1) or is **absent**
  (the adapter supplies them, §3.2). Consistent with how the verbs are wired.
- **The host-global home (transient)** — premo's instance registry, at
  `$PREMO_HOME/data/<project>/registry.json` (default `~/.premo/…`); never
  committed. Keyed by the repo's **main worktree** (resolved with `git worktree
list`), so every linked worktree of a repo shares one namespace and instances
  outlive any single worktree (§6 Q3/Q4). premo owns it:

```jsonc
// ~/.premo/data/<project>/registry.json
{
  "instances": [
    { "handle": "d_golden", "name": "golden", "from": "live", "createdAt": "…" },
    { "handle": "d_4f2a9c", "name": "pr-123", "from": "d_golden", "createdAt": "…" },
  ],
}
```

Mutations take a file lock (shared with the port registry) so two worktrees
minting at once can't clobber the registry. This is what lets `delete`/`list`/
`clone` work without the consumer or the scripts tracking anything — and work
from _any_ worktree. Any substrate-specific location/id is **adapter-internal** — the
directory adapter derives its path from the handle (an instance dir under
`$PREMO_HOME/data/<project>/<handle>`, so it too survives a worktree teardown); an
id-assigning adapter (§3.3) stores its descriptor here — but neither is ever
surfaced in `--json`. The handle is the only public reference.

---

## 4. Implementation suggestions (premo's call)

The contracts in §3 cover the bulk of the design; what remains here are residual
notes for whoever implements it.

- **Ship both layers from day one.** The handle contract (§3.1) is the universal
  floor; the directory adapter (§3.2) is the zero-script path for the common shape.
  Shipping the adapter alongside the wired contract is what makes the axis dogfoodable
  immediately (`odo/email` is a directory-shaped repo).
- **`dev --data` injection** mirrors the existing `PORT` injection: resolve the
  handle, set `PREMO_DATA_HANDLE` (and `PREMO_DATA_DIR` under the directory adapter)
  in the run env, layered into the same env the dev children already get.
- **CoW clones** (§3.2) are what keep `clone` of a large instance near-instant; the
  plain-copy fallback keeps it correct on filesystems without `clonefile`/reflink.
- **Isolation and side-effect safety** are §3.1 invariants 1 and 4 — load-bearing,
  not optional, and the strongest argument for adapters owning the semantics rather
  than every project reinventing them.

---

## 5. Bootstrapping a golden dataset

"Default = clone the golden data" presupposes a golden instance exists. Minting one
is a one-liner — `clone` the project's live working data (the `live` source) after
the app has accumulated useful state:

```sh
# after running the real app at the desk and accumulating useful data under data.dir:
premo data clone live --name golden --json
# → a persistent instance named "golden"; clone IT for each preview.
```

There's nothing special about "golden" — it's just an instance someone named and
doesn't delete. A dev gets this for free at the desk too (`premo data create` /
`clone` / `list` are independently useful), the same "two consumers of one
primitive" relationship premo+orchestrator already have for worktrees.

---

## 6. Open questions for premo to settle

1. **Default choice — resolved: consumer policy.** premo no longer tracks a
   `defaultReference` or a retained/ephemeral split; every instance is equal and
   persistent. "Which one is the golden to clone by default" is the consumer's
   bookkeeping (e.g. find the instance named `golden` in `data list`). _(Dropped
   from premo — was the original §6 Q1.)_
2. **Adapter vs handle-contract-only for v1 — resolved: both.** Shipped the
   directory adapter (§3.2) alongside the wired handle contract (§3.1).
3. **Instance storage location — resolved: host-global.** Both the registry and
   the directory adapter's instance dirs live under `$PREMO_HOME/data/<project>/`
   (default `~/.premo/…`), not in the checkout. So instances survive a worktree
   teardown and a clone made in one worktree is reachable from the next — which is
   exactly what the orchestrator's detached-worktree-per-PR model needs.
4. **Handle scope — resolved: per-repo, cross-worktree.** The namespace is keyed by
   the repo's **main worktree** (`git worktree list`; falls back to the checkout
   path outside git), so every linked worktree of a repo shares one set of handles.
   Handles themselves are random and effectively globally unique, but lookups are
   scoped to the project — a consumer still runs `premo data …` in a project
   context, it just no longer matters _which_ worktree.
5. **`--data` + `--port-base` together.** Confirm both land as orthogonal
   orchestrator-supplied parameters on `premo dev` (and `premo ports`/`premo data`
   stay independently queryable), so the consumer composes `(worktree, port-base,
data)` freely.

---

## Appendix: the consumer's full call sequence

```sh
# 1. populate the picker
premo data list --json                       # → instances (consumer picks the default)

# 2. stand up a preview for PR #123 against a clone of the golden data
H=$(premo data clone d_golden --name pr-123 --json | jq -r .handle)
premo dev --data "$H" --port-base 48760 --background

# 3. discover where it's serving (separate port proposal)
premo ports --json --port-base 48760         # → redirect target

# 4. reap on idle / merge / close
premo stop                                   # existing: stop the dev procs
premo data delete "$H"                       # this proposal: drop the data
```

Everything the orchestrator touches is a `premo` invocation with `--json`. premo
owns config, storage, isolation, and the instance registry; the orchestrator owns
the worktree, the port-base, the data _choice_, and the lifecycle.

import { readdir } from "node:fs/promises";
import { VERBS, type Verb } from "../manifest/types.js";
import { inspectContext } from "./context.js";
import { resolvePackages } from "./packages.js";

// The skill tier (DESIGN §3/§7): when convention + configure can't produce a
// working config, premo emits a SKILL.md — a self-contained task file that
// teaches a coding agent how to finish wiring premo for this repo.

export const SKILL_FILE = "SKILL.md";

// Build-system fingerprints. Each present file is a strong hint about what the
// verb commands should be, surfaced to the agent so it doesn't have to guess.
const SIGNALS: { match: (entry: string) => boolean; label: string; hint: string }[] = [
  {
    match: (e) => e === "package.json",
    label: "package.json",
    hint: "Node — verbs usually map to `package.json` scripts (`yarn <s>` / `npm run <s>`).",
  },
  {
    match: (e) => e === "Makefile" || e === "makefile",
    label: "Makefile",
    hint: "Make — `make <target>` per verb (e.g. `make build`, `make test`).",
  },
  {
    match: (e) => e === "Cargo.toml",
    label: "Cargo.toml",
    hint: "Rust — `cargo run` / `cargo build` / `cargo test` / `cargo clippy --fix`.",
  },
  {
    match: (e) => e === "go.mod",
    label: "go.mod",
    hint: "Go — `go run ./...` / `go build ./...` / `go test ./...`.",
  },
  {
    match: (e) => e === "pyproject.toml",
    label: "pyproject.toml",
    hint: "Python — poetry/uv/hatch; look for a `[tool.*.scripts]` or a task runner.",
  },
  {
    match: (e) => e === "requirements.txt",
    label: "requirements.txt",
    hint: "Python (pip) — check for a Makefile/tox/nox that defines the verbs.",
  },
  {
    match: (e) => e === "Gemfile",
    label: "Gemfile",
    hint: "Ruby/Bundler — `bundle exec <cmd>` (rails, rake, rspec…).",
  },
  {
    match: (e) => e === "build.gradle" || e === "build.gradle.kts",
    label: "Gradle build file",
    hint: "Gradle — `./gradlew <task>` (e.g. `assemble`, `test`).",
  },
  {
    match: (e) => e === "pom.xml",
    label: "pom.xml",
    hint: "Maven — `mvn <phase>` (`package`, `test`).",
  },
  {
    match: (e) => e === "deno.json" || e === "deno.jsonc",
    label: "Deno config",
    hint: "Deno — `deno task <name>`.",
  },
  {
    match: (e) => e === "Dockerfile",
    label: "Dockerfile",
    hint: "Containerized — `dev` may be a `docker` / `docker compose` invocation.",
  },
  {
    match: (e) => e === "docker-compose.yml" || e === "compose.yaml",
    label: "compose file",
    hint: "Compose — `dev` is likely `docker compose up`; `stop` maps to `down`.",
  },
  {
    match: (e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"),
    label: "Xcode project",
    hint: "Native Apple app — the `xcode` adapter should handle this; re-run `premo adopt`.",
  },
];

export interface SkillContext {
  name: string;
  root: string;
  adapter: string | null;
  wired: { verb: Verb; command: string }[];
  unwired: Verb[];
  signals: { label: string; hint: string }[];
}

export async function gatherSkillContext(cwd: string): Promise<SkillContext> {
  const { root, manifest, adapterName } = await inspectContext(cwd);
  const packages = await resolvePackages(root, manifest);

  const wired: { verb: Verb; command: string }[] = [];
  const unwired: Verb[] = [];
  for (const verb of VERBS) {
    const hit = packages.find((p) => p.commands[verb]);
    if (hit) wired.push({ verb, command: hit.commands[verb]! });
    else unwired.push(verb);
  }

  const entries = await readdir(root).catch(() => [] as string[]);
  const signals: { label: string; hint: string }[] = [];
  for (const sig of SIGNALS) {
    if (entries.some((e) => sig.match(e))) signals.push({ label: sig.label, hint: sig.hint });
  }

  return { name: manifest.name, root, adapter: adapterName, wired, unwired, signals };
}

export function renderSkill(ctx: SkillContext): string {
  const verbList = "`" + VERBS.join("` · `") + "`";
  const signalLines =
    ctx.signals.length > 0
      ? ctx.signals.map((s) => `- **${s.label}** — ${s.hint}`).join("\n")
      : "- _No standard build-system files detected at the repo root. Inspect the project to find how it is built and run._";
  const wiredLines =
    ctx.wired.length > 0
      ? ctx.wired.map((w) => `- \`${w.verb}\` → \`${w.command}\``).join("\n")
      : "- _none yet_";
  const unwiredLines =
    ctx.unwired.length > 0
      ? ctx.unwired.map((v) => `- \`${v}\``).join("\n")
      : "- _none — every verb already resolves_";

  return `# premo skill: wire up \`${ctx.name}\`

You are a coding agent. premo couldn't fully resolve its verbs for this repo
automatically, so your task is to finish wiring it by writing/extending a
\`premo.json\` at the repo root. premo never runs bespoke logic — it only reads
\`premo.json\` and shells out — so everything you need lives in that one file.

## The contract

premo exposes one fixed, closed set of verbs that must mean the same thing in
every repo: ${verbList}. Map each one to the command this project _actually_
uses. Do **not** invent new verbs; project-specific entry points belong under
\`shells\`, not as new verbs.

| Verb     | What it must do here                                                        |
| -------- | -------------------------------------------------------------------------- |
| \`dev\`    | Run the project locally in the foreground (watch mode if it has one).       |
| \`build\`  | Produce the build artifact(s).                                              |
| \`test\`   | Run the test suite.                                                         |
| \`lint\`   | Lint and **auto-fix** in place (a \`--dry\` variant checks only).             |
| \`deploy\` | Ship it (often left unset until there's a real deploy path).                |

## What premo found in this repo

- **Adapter:** ${ctx.adapter ?? "none matched"}
- **Root:** \`${ctx.root}\`

Build-system signals detected:

${signalLines}

Already-wired verbs:

${wiredLines}

Verbs still missing (your job):

${unwiredLines}

## Your task

1. Figure out the real command for each missing verb, using the signals above
   and by reading the repo (build config, CI files, README, existing scripts).
2. Create or edit \`premo.json\` at the repo root. Minimal shape:

   \`\`\`jsonc
   {
     "name": "${ctx.name}",
     "commands": {
       "dev": "…",
       "build": "…",
       "test": "…",
       "lint": "…"
       // omit a verb (or set null) if there's genuinely no command for it
     }
   }
   \`\`\`

   For a monorepo, declare \`packages\` (each with a \`name\` and \`dirs\`) and put
   per-package overrides under that package's \`commands\`. See DESIGN.md §4, §13.
3. If the project serves HTTP in dev, have the \`dev\` command bind \`$PORT\`
   (premo exports an allocated port). Forward it explicitly if the tool ignores
   the env var (e.g. Vite needs \`--port $PORT\`).

## Verify

\`\`\`bash
premo doctor --json   # confirm every verb shows as wired, "unwired" is empty
premo dev             # actually runs the project
premo build && premo test && premo lint
\`\`\`

The repo is "done" when \`premo doctor --json\` reports no unwired verbs and each
verb runs the right tool.

## If this generalizes

If the wiring you wrote would apply to _any_ project of this kind (not just this
one), it's a candidate for a built-in **adapter** so the next repo needs no
SKILL.md at all. See CONTRIBUTING.md — that's the skill → configure → convention
promotion the design is built around.
`;
}

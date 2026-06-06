# Security

## Trust model

premo's job is to **run the commands a project declares** — in `premo.json` and,
through the built-in adapters, in your `package.json` scripts / `xcodebuild` /
etc. Running `premo <verb>` in a repository runs that repository's configured
commands, exactly as `npm run <script>` would. So:

> **Only run premo in repositories you trust.** Treat `premo build`/`dev`/… in an
> unfamiliar repo the same way you'd treat `npm install` or running its scripts —
> because that's effectively what it does.

This matters especially when an **agent** invokes premo automatically: it should
do so only in trusted projects.

What premo does and doesn't do:

- **Reads `premo.json` and shells out** to your real toolchain. It doesn't bundle
  or fetch any execution engine of its own.
- **No telemetry, no network calls of its own.** (Your project's commands may do
  whatever they do.)
- **Writes only within the project** (`premo.json`, `.premo-local.json`,
  `.runtime/` logs, the xcode build cache) plus a per-machine **port registry**
  under `~/.premo` (or `$PREMO_HOME`). Uninstalling premo leaves the repo working.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Preferred: GitHub's **"Report a vulnerability"** (Security tab → Advisories).
- Or email **andrew@odo.do**.

We'll acknowledge the report and work on a fix; please allow reasonable time to
remediate before any public disclosure.

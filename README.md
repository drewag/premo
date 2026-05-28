# strand

An opinionated CLI for scaffolding, managing, and running component-based, agent-friendly coding projects.

> Status: **v0 in active construction.** See [DESIGN.md](./DESIGN.md) for the full design.

## Quick start (target — not all commands implemented yet)

```bash
strand new myapp --with backend,web-app,db
cd myapp
strand dev
```

You get a typed-end-to-end monorepo: Postgres in Docker, Express backend, Vite/React web-app, a shared Zod API contract, and a `.claude/` directory of skills the project's agents already know how to use.

## What's a strand?

A pluggable component. Initial set:

| Strand    | Stack                                 |
| --------- | ------------------------------------- |
| `shared`  | Zod API contract registry, types      |
| `backend` | Express + Prisma + Zod                |
| `web-app` | Vite + React 19 + Tailwind + shadcn   |
| `site`    | Next.js 15 (static export)            |
| `db`      | Postgres 16 in Docker Compose         |
| `ios`     | SwiftUI + Swift codegen from `shared` |

A _project_ is a `strand.json` listing which strands are active, plus a normal monorepo. Strands are additive; new ones drop into `strands/` in this repo.

## Development

Requires Node 22+, Yarn 1 (classic), Docker.

```bash
yarn install
yarn test                # unit tests (fast)
yarn test:integration    # end-to-end project scaffolding (slow, needs Docker)
yarn lint
```

### Trying it out in a new shell

To use the in-development `strand` command from anywhere, **source the activator** in your shell:

```bash
source ./bin/activate.sh
strand doctor
strand new myapp --dir playground --with shared,backend,web-app
cd playground/myapp && yarn install && strand dev
```

The activator defines `strand` (and `strand-deactivate`) as shell functions in the current shell only. Exiting the shell removes them — there's no PATH change, no symlink, nothing to remember to undo. `playground/` is gitignored, so scaffolded test projects stay local.

## License

MIT (planned; license file to follow on first publish).

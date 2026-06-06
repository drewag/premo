# dbapp

This project was scaffolded with `strand`. Active strands:

- **shared** — Zod-typed API contract registry shared by backend, web-app, and ios.
- **db** — Postgres 16 running in Docker Compose, with per-project volume.
- **backend** — Express + Zod API server. Registers handlers against the shared ApiSchema.

## shared

### The shared contract

`shared/src/api/routes.ts` is the **single source of truth** for every API endpoint. Each entry is an `ApiEndpoint` defined with Zod schemas for request and response. Backend handlers register against these entries; frontend calls them by reference. There is no other endpoint definition anywhere in the project — adding an endpoint means editing this file.

When asked to add or change an API surface, always edit `shared/src/api/routes.ts` first and let the type-checker drive the backend and frontend changes.

## db

### Database

Postgres 16 runs in Docker Compose as the `db` service. Connect locally with `psql -h localhost -p $PG_PORT -U app -d app` (password `app`). The data volume is under `~/.strand-data/dbapp/postgres/` and persists across `strand stop` / `strand dev`. To wipe it, stop the project and `rm -rf` the directory.

## backend

### Backend

Express server in `backend/`. Entry: `src/api.ts`. Handlers are registered against `ApiSchema` from `@dbapp/shared` via `serveEndpoint(app, ApiSchema.x, async (data) => …)`. Never define endpoints inline — always add the schema to `shared/src/api/routes.ts` first.

Run the test suite with `yarn workspace @dbapp/backend test` (or `yarn test` at root).

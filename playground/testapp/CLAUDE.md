# testapp

This project was scaffolded with `strand`. Active strands:

- **shared** — Zod-typed API contract registry shared by backend, web-app, and ios.
- **backend** — Express + Zod API server. Registers handlers against the shared ApiSchema.
- **web-app** — Vite + React 19 SPA. Optionally talks to backend via the shared ApiSchema.

## shared

### The shared contract

`shared/src/api/routes.ts` is the **single source of truth** for every API endpoint. Each entry is an `ApiEndpoint` defined with Zod schemas for request and response. Backend handlers register against these entries; frontend calls them by reference. There is no other endpoint definition anywhere in the project — adding an endpoint means editing this file.

When asked to add or change an API surface, always edit `shared/src/api/routes.ts` first and let the type-checker drive the backend and frontend changes.

## backend

### Backend

Express server in `backend/`. Entry: `src/api.ts`. Handlers are registered against `ApiSchema` from `@testapp/shared` via `serveEndpoint(app, ApiSchema.x, async (data) => …)`. Never define endpoints inline — always add the schema to `shared/src/api/routes.ts` first.

Run the test suite with `yarn workspace @testapp/backend test` (or `yarn test` at root).

## web-app

### Web app

React 19 SPA in `web-app/`, built with Vite. Calls the backend via `callEndpoint(ApiSchema.x, input)` (see `src/api/client.ts`), which gives full type inference from the schema in `@testapp/shared`. Do not add raw `fetch` calls to API routes — go through `callEndpoint`.

Tests use Vitest + React Testing Library in jsdom.

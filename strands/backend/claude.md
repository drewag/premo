### Backend

Express server in `backend/`. Entry: `src/api.ts`. Handlers are registered against `ApiSchema` from `@{{projectName}}/shared` via `serveEndpoint(app, ApiSchema.x, async (data) => …)`. Never define endpoints inline — always add the schema to `shared/src/api/routes.ts` first.

Run the test suite with `yarn workspace @{{projectName}}/backend test` (or `yarn test` at root).

### Web app

React 19 SPA in `web-app/`, built with Vite. Calls the backend via `callEndpoint(ApiSchema.x, input)` (see `src/api/client.ts`), which gives full type inference from the schema in `@{{projectName}}/shared`. Do not add raw `fetch` calls to API routes — go through `callEndpoint`.

Tests use Vitest + React Testing Library in jsdom.

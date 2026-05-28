### The shared contract

`shared/src/api/routes.ts` is the **single source of truth** for every API endpoint. Each entry is an `ApiEndpoint` defined with Zod schemas for request and response. Backend handlers register against these entries; frontend calls them by reference. There is no other endpoint definition anywhere in the project — adding an endpoint means editing this file.

When asked to add or change an API surface, always edit `shared/src/api/routes.ts` first and let the type-checker drive the backend and frontend changes.

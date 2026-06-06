import { defineConfig } from "vitest/config";

// Integration tests drive the built `dist/bin/premo.js` against real fixture
// repos (subprocess + git), so they're slower than the unit suite and run on
// their own: `yarn test:integration`. globalSetup builds dist once.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      // Surface untested files as 0% rather than omitting them.
      all: true,
      // Coverage is measured in-process, so it reflects the unit suite. Code
      // exercised only by the (subprocess) integration suite isn't credited.
    },
  },
});

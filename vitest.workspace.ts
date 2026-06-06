import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["test/unit/**/*.test.ts"],
      environment: "node",
    },
  },
]);

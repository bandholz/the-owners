import { defineConfig } from "vitest/config";

/**
 * Unit tests run in Node (fast). Google + D1 are mocked.
 * Full Workers runtime pool can be added after Eric approves deps upgrades;
 * algorithm and crypto correctness do not need workerd for v1 scaffolding.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text"] },
  },
});

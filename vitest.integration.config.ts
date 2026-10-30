import { defineConfig } from "vitest/config";

// Integration tests run against a separate database (fr_mailer_test), reset before each run.
// Start them with: npm run test:integration
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    setupFiles: ["./tests/setup-integration.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

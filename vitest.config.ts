import { configDefaults, defineConfig } from "vitest/config";

// Unit tests. Integration tests (*.int.test.ts) need a database: npm run test:integration
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-unit.ts"],
    exclude: [...configDefaults.exclude, "**/*.int.test.ts", "dist/**"],
  },
});

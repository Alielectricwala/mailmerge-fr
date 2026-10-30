// npm run test:integration — resets the *_test database, applies migrations, runs the suite.
import { spawnSync } from "child_process";
import { assertTestDatabase, testDatabaseEnv } from "./test-db.mjs";

const env = { ...process.env, ...testDatabaseEnv() };
// Re-check the exact values the child processes will see, before anything destructive runs
assertTestDatabase(env.DATABASE_URL, "DATABASE_URL");
assertTestDatabase(env.DIRECT_URL, "DIRECT_URL");

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed", "--skip-generate"]);
run("npx", ["vitest", "run", "-c", "vitest.integration.config.ts", ...process.argv.slice(2)]);

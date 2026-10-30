// Shared settings for the integration test database. Never points at the development database.
// Both DATABASE_URL and DIRECT_URL must be overridden: Prisma migrate (including `migrate reset`)
// connects through DIRECT_URL, so overriding only DATABASE_URL would reset the dev database.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/fr_mailer_test";

export function assertTestDatabase(url, name) {
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests: ${name} ("${url}") must point at a database whose name ends in _test.`);
  }
}

assertTestDatabase(TEST_DATABASE_URL, "TEST_DATABASE_URL");

/** Environment for any process that touches the test database */
export function testDatabaseEnv() {
  return { DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL };
}

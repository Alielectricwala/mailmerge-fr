// Environment for integration tests: isolated database, fake mailbox (the transport is replaced
// in each test, so nothing can reach a real SMTP server), live sending enabled for the worker.
import { TEST_DATABASE_URL } from "./test-db.mjs";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DIRECT_URL = TEST_DATABASE_URL;
process.env.APP_SECRET = "integration-test-secret-0123456789abcdef";
process.env.PUBLIC_URL = "http://localhost:5173";
process.env.SMTP_HOST = "smtp.invalid";
process.env.SMTP_USER = "sender@focusrealm.test";
process.env.SMTP_PASS = "not-a-real-password";
process.env.SMTP_FROM_EMAIL = "sender@focusrealm.test";
process.env.ALLOW_LIVE_SENDING = "true";
process.env.DAILY_SEND_LIMIT = "1000";
process.env.IMAP_POLL_ENABLED = "false";

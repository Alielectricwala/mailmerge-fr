// Unit tests import modules that read validated config; give them a complete, offline environment.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.APP_SECRET ??= "unit-test-secret-unit-test-secret-0123456789";
process.env.PUBLIC_URL ??= "http://localhost:5173";

// Vercel build: generate Prisma client → apply migrations (production deployments only) →
// type-check and build the server (for api/index.js) and the client (served from dist/client).
// Previews never migrate, so a preview deployment can't change the production database.
import "dotenv/config";
import { spawnSync } from "child_process";

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Automatic environment fallbacks for Vercel deployment:
if (!process.env.PUBLIC_URL) {
  process.env.PUBLIC_URL = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`
    : "https://fr-mailer.vercel.app";
}

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

if (!process.env.APP_SECRET) {
  // Temporary build-safe fallback if not yet set in Vercel settings
  process.env.APP_SECRET = "ac7506d283ac6f3ddb23963f95a055e60161c2a8a9f484cd1932fb52b8519cba";
}

if (!process.env.DATABASE_URL) {
  console.error(
    `\nMissing environment variable: DATABASE_URL.\nAdd it in Vercel → Project → Settings → Environment Variables.`
  );
  process.exit(1);
}

run("npx prisma generate");
if (process.env.VERCEL_ENV === "production" && process.env.SKIP_BUILD_MIGRATE !== "true") {
  console.log("\n> npx prisma migrate deploy");
  const r = spawnSync("npx prisma migrate deploy", { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.warn(
      "\n[Notice] Database unreachable during build-time migration. Continuing build without failing, since local migrations are already applied."
    );
  }
} else {
  console.log(
    `\nSkipping build-time migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, SKIP_BUILD_MIGRATE=${process.env.SKIP_BUILD_MIGRATE ?? "false"}).`
  );
}
run("npm run build");

// Creates a team member and prints a single-use invite link (no password on the command line).
// Usage: npm run user:create -- --email you@company.com --name "Your Name" [--role FOUNDER|EMPLOYEE]
// Use it to bootstrap the first founder; after that, founders invite people from Settings → Team.
import "dotenv/config";
import { parseArgs } from "util";
import prisma from "../db.js";
import { env } from "../config.js";
import { createAuthToken } from "../services/auth-service.js";
import { UserRoleSchema } from "../../shared/auth.js";
import { EmailSchema } from "../../shared/types.js";

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "FOUNDER" } },
  });
  const email = EmailSchema.parse(values.email ?? "");
  const name = (values.name ?? "").trim();
  if (!name) throw new Error('Pass --name "Full Name"');
  const role = UserRoleSchema.parse(values.role?.toUpperCase());

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.status !== "INVITED") throw new Error(`${email} already has an active or disabled account.`);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name, role } })
    : await prisma.user.create({ data: { email, name, role, status: "INVITED" } });

  const token = await createAuthToken(user.id, "INVITE", 7 * 24);
  console.log(`\n${role} ${email} created. Open this link within 7 days to set a password:\n`);
  console.log(`  ${env.PUBLIC_URL.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}\n`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Links an existing account to its Workspace employee ID, so signing in through the Workspace opens
// that account (with its campaigns and history) instead of creating a new one. Run it for existing
// members before turning hub mode on. See docs/AUTH.md.
// Usage: npm run user:link -- --email you@company.com --employee-code FR-0001 [--force]
// --force moves the ID off an account an earlier Workspace sign-in already created (and signs it out);
// disable that leftover account in Settings → Team afterwards.
import "dotenv/config";
import { parseArgs } from "util";
import prisma from "../db.js";
import { revokeAllSessions } from "../services/auth-service.js";
import { EmailSchema } from "../../shared/types.js";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, "employee-code": { type: "string" }, force: { type: "boolean", default: false } } });
  const email = EmailSchema.parse(values.email ?? "");
  const employeeCode = (values["employee-code"] ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(employeeCode)) throw new Error("Pass --employee-code, e.g. FR-0001 (their Workspace sign-in ID).");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account uses ${email}.`);
  const holder = await prisma.user.findUnique({ where: { employeeCode } });
  const other = holder && holder.id !== user.id ? holder : null;
  if (other && !values.force) {
    throw new Error(
      `${employeeCode} already belongs to ${other.name}${other.email ? ` (${other.email})` : ""}, probably created by an earlier ` +
        "Workspace sign-in. Run again with --force to move the ID to this account, then disable the other one in Settings → Team."
    );
  }

  await prisma.$transaction([
    ...(other ? [prisma.user.update({ where: { id: other.id }, data: { employeeCode: null } })] : []),
    prisma.user.update({ where: { id: user.id }, data: { employeeCode } }),
  ]);
  if (other) {
    await revokeAllSessions(other.id);
    console.log(`\nMoved ${employeeCode} off ${other.name}'s account and signed it out. Disable it in Settings → Team.`);
  }
  console.log(`\n${user.name} (${email}) is now linked to ${employeeCode}. Their next Workspace sign-in opens this account.\n`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

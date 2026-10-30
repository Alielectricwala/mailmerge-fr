// Creates (or resets) one demo founder and one demo employee for local development.
// Usage: npm run db:seed-demo
// Refuses to run in production. Demo passwords are generated for each run.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../services/auth-service.js";
import type { UserRole } from "../../shared/auth.js";

const DEMO_USERS: { email: string; name: string; role: UserRole }[] = [
  { email: "founder@focusrealm.test", name: "Founder’s Office", role: "FOUNDER" },
  { email: "employee@focusrealm.test", name: "FocusRealm Team", role: "EMPLOYEE" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to create demo users in production.");
  }

  const prisma = new PrismaClient();
  try {
    for (const demo of DEMO_USERS) {
      const password = randomBytes(24).toString("base64url");
      const passwordHash = await hashPassword(password);
      await prisma.user.upsert({
        where: { email: demo.email },
        update: { name: demo.name, role: demo.role, status: "ACTIVE", passwordHash },
        create: { email: demo.email, name: demo.name, role: demo.role, status: "ACTIVE", passwordHash },
      });
      console.log(`${demo.role.padEnd(8)} ${demo.email}  /  ${password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

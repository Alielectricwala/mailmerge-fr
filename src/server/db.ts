// Prisma client singleton with logging
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

// Always preserve singleton across serverless requests and hot reloads
globalForPrisma.prisma = prisma;

// Graceful shutdown — avoid on serverless where beforeExit fires on idle event loops
if (process.env.VERCEL !== "1" && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  process.on("beforeExit", async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
}

export default prisma;
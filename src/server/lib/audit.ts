// Records important actions for the founder-only Activity view
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import prisma from "../db.js";

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export async function audit(req: Request | null, entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      userId: req?.user?.id,
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent")?.slice(0, 300) ?? null,
    },
  });
}

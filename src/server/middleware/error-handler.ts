// Error handling: every failure becomes { success: false, error: { code, message, details? } }
// with a message a person can act on. Only unexpected (5xx) errors are logged with a stack.
import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import multer from "multer";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, 400, details);
  }
  static unauthorized(code: string, message = "Sign in to continue") {
    return new AppError(code, message, 401);
  }
  static forbidden(code: string, message = "You don't have permission to do that") {
    return new AppError(code, message, 403);
  }
  static notFound(code: string, message = "Not found") {
    return new AppError(code, message, 404);
  }
  static conflict(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, 409, details);
  }
}

// Human names for unique constraints, so "duplicate" errors say what clashed
const UNIQUE_MESSAGES: Record<string, string> = {
  Template: "A template with this name already exists.",
  Campaign: "A campaign with this name already exists.",
  ContactList: "A list with this name already exists.",
  Contact: "A contact with this email already exists.",
  User: "Someone on the team already uses this email.",
  SuppressionEntry: "This address is already on the suppression list.",
};

function send(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join(".");
    const message = first ? (field && first.message === "Required" ? `${field} is required` : first.message) : "Check the form and try again";
    return send(res, 400, "VALIDATION_ERROR", message, err.flatten().fieldErrors);
  }

  if (err instanceof AppError) {
    return send(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "That file is larger than 4 MB. Split it into smaller files." : `Upload failed: ${err.message}`;
    return send(res, 400, "UPLOAD_ERROR", message);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return send(res, 409, "DUPLICATE", UNIQUE_MESSAGES[String(err.meta?.modelName)] ?? "That already exists.");
    }
    if (err.code === "P2025") return send(res, 404, "NOT_FOUND", "That item no longer exists.");
    if (err.code === "P2003") return send(res, 409, "IN_USE", "It's still used elsewhere, so it can't be removed.");
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error(`[ERROR] ${req.method} ${req.path}: database unreachable — ${err.message.split("\n").pop()}`);
    return send(res, 503, "DATABASE_UNAVAILABLE", "The database isn't reachable. Check that it's running, then try again.");
  }

  if ((err as { type?: string }).type === "entity.too.large") {
    return send(res, 413, "TOO_LARGE", "That request is too large.");
  }

  console.error(`[ERROR] ${req.method} ${req.path}`, err);
  return send(
    res,
    500,
    "INTERNAL_ERROR",
    process.env.NODE_ENV === "development" ? err.message : "Something went wrong on our side. Try again in a moment."
  );
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

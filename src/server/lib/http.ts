// Response helpers so every route returns the same envelope
import type { Response } from "express";
import type { Pagination } from "../../shared/types.js";

export function ok<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data });
}

export function okPage<T>(res: Response, data: T[], page: number, pageSize: number, total: number) {
  const pagination: Pagination = { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  res.json({ success: true, data, pagination });
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Optional trimmed search string from a query param */
export function searchParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;
}

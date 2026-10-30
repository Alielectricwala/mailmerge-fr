// API client. Every response is { success, data, pagination? } or { success: false, error }.
import type { Pagination } from "@shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  pagination?: Pagination;
}

async function parse<T>(res: Response): Promise<ApiEnvelope<T>> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const fallback =
      res.status === 502 || res.status === 504
        ? "The server isn't responding. Make sure it's running, then try again."
        : res.status >= 500
          ? "Something went wrong on the server. Try again in a moment."
          : "The request couldn't be completed.";
    throw new ApiError(res.status, body?.error?.code ?? "API_ERROR", body?.error?.message ?? fallback, body?.error?.details);
  }
  return body as ApiEnvelope<T>;
}

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(endpoint, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and that the app server is running.");
  }
  return parse<T>(res);
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, json("POST", body)),
  put: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, json("PUT", body)),
  patch: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, json("PATCH", body)),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
  upload: <T>(endpoint: string, form: FormData) => request<T>(endpoint, { method: "POST", body: form }),
};

/** Builds a query string, skipping empty values */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : "";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

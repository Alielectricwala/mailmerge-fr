import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireAuth, requirePermission } from "./session.js";
import { AppError } from "./error-handler.js";
import type { SessionUser } from "../../shared/auth.js";

function run(middleware: (req: Request, res: Response, next: (err?: unknown) => void) => void, user?: SessionUser) {
  const next = vi.fn();
  middleware({ user } as Request, {} as Response, next);
  const err = next.mock.calls[0]?.[0];
  return err instanceof AppError ? err.statusCode : err === undefined ? "next" : err;
}

const founder: SessionUser = { id: "u1", email: "f@focusrealm.com", name: "F", role: "FOUNDER", status: "ACTIVE" };
const employee: SessionUser = { ...founder, id: "u2", role: "EMPLOYEE" };

describe("requireAuth", () => {
  it("rejects anonymous requests with 401", () => expect(run(requireAuth)).toBe(401));
  it("rejects disabled users with 403", () => expect(run(requireAuth, { ...employee, status: "DISABLED" })).toBe(403));
  it("passes active users", () => expect(run(requireAuth, employee)).toBe("next"));
});

describe("requirePermission", () => {
  it("rejects anonymous requests with 401", () => expect(run(requirePermission("campaigns.view"))).toBe(401));
  it("blocks employees from approving", () => expect(run(requirePermission("campaigns.approve"), employee)).toBe(403));
  it("lets founders approve", () => expect(run(requirePermission("campaigns.approve"), founder)).toBe("next"));
  it("lets employees request approval", () => expect(run(requirePermission("campaigns.request_approval"), employee)).toBe("next"));
});

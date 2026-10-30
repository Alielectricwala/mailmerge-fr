import { describe, it, expect } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, canAct, PERMISSION_LABELS } from "./auth.js";

describe("role permissions", () => {
  it("gives founders every permission", () => {
    for (const p of PERMISSIONS) expect(hasPermission("FOUNDER", p)).toBe(true);
  });

  it("keeps the approval gate and admin actions founder-only", () => {
    expect(hasPermission("EMPLOYEE", "campaigns.approve")).toBe(false);
    expect(hasPermission("EMPLOYEE", "suppressions.remove")).toBe(false);
    expect(hasPermission("EMPLOYEE", "settings.manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "users.manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "audit.view")).toBe(false);
  });

  it("lets employees do day-to-day work", () => {
    expect(hasPermission("EMPLOYEE", "contacts.manage")).toBe(true);
    expect(hasPermission("EMPLOYEE", "templates.manage")).toBe(true);
    expect(hasPermission("EMPLOYEE", "campaigns.manage")).toBe(true);
    expect(hasPermission("EMPLOYEE", "campaigns.request_approval")).toBe(true);
    expect(hasPermission("EMPLOYEE", "campaigns.send_test")).toBe(true);
    expect(hasPermission("EMPLOYEE", "suppressions.add")).toBe(true);
  });

  it("only grants employees a subset of founder permissions", () => {
    for (const p of ROLE_PERMISSIONS.EMPLOYEE) expect(ROLE_PERMISSIONS.FOUNDER.has(p)).toBe(true);
  });

  it("labels every permission", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
  });

  it("denies everything to users who are not active", () => {
    expect(canAct({ role: "FOUNDER", status: "DISABLED" }, "campaigns.view")).toBe(false);
    expect(canAct({ role: "FOUNDER", status: "INVITED" }, "campaigns.approve")).toBe(false);
    expect(canAct({ role: "FOUNDER", status: "ACTIVE" }, "campaigns.approve")).toBe(true);
  });
});

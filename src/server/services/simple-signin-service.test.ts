import { afterEach, describe, it, expect } from "vitest";
import { FrIdSchema, SimpleSignInSchema } from "../../shared/auth.js";
import { resetSimpleSignInAttempts, roleForEmployeeCode, SIMPLE_SIGNIN_LIMIT, takeSimpleSignInAttempt } from "./simple-signin-service.js";

describe("FR IDs", () => {
  it.each([
    ["FR-0042", "FR-0042"],
    ["fr-0042", "FR-0042"],
    ["  Fr-7  ", "FR-7"],
    ["FR-12345678", "FR-12345678"],
  ])("accepts %j as %s", (input, expected) => expect(FrIdSchema.parse(input)).toBe(expected));

  it.each(["", "FR-", "FR0042", "FR-00A2", "LG-0001", "FR-0042-1", "FR- 0042", "FR-123456789", "x FR-0042"])("refuses %j", (input) => {
    expect(FrIdSchema.safeParse(input).success).toBe(false);
  });
});

describe("the sign-in form", () => {
  it("trims the name and normalizes the FR ID", () => {
    expect(SimpleSignInSchema.parse({ name: "  Priya Menon ", employeeCode: " fr-0042" })).toEqual({ name: "Priya Menon", employeeCode: "FR-0042" });
  });
  it("needs a name", () => {
    expect(SimpleSignInSchema.safeParse({ name: "   ", employeeCode: "FR-1" }).success).toBe(false);
    expect(SimpleSignInSchema.safeParse({ employeeCode: "FR-1" }).success).toBe(false);
  });
  it("needs an FR ID", () => expect(SimpleSignInSchema.safeParse({ name: "Priya" }).success).toBe(false));
});

describe("roleForEmployeeCode", () => {
  const founders = new Set(["FR-0001", "FR-0002"]);
  it("makes listed FR IDs founders", () => expect(roleForEmployeeCode("FR-0001", founders)).toBe("FOUNDER"));
  it("makes everyone else an employee", () => expect(roleForEmployeeCode("FR-0042", founders)).toBe("EMPLOYEE"));
  it("makes everyone an employee when nobody is listed", () => expect(roleForEmployeeCode("FR-0001", new Set())).toBe("EMPLOYEE"));
});

describe("sign-in rate limit", () => {
  afterEach(() => resetSimpleSignInAttempts());

  it("allows the limit per IP, then asks to wait until the window ends", () => {
    const now = 1_000_000;
    for (let i = 0; i < SIMPLE_SIGNIN_LIMIT.max; i++) expect(takeSimpleSignInAttempt("1.2.3.4", now)).toBeNull();
    expect(takeSimpleSignInAttempt("1.2.3.4", now)).toBe(SIMPLE_SIGNIN_LIMIT.windowMs / 1000);
    // Another IP is unaffected
    expect(takeSimpleSignInAttempt("5.6.7.8", now)).toBeNull();
    // The window resets
    expect(takeSimpleSignInAttempt("1.2.3.4", now + SIMPLE_SIGNIN_LIMIT.windowMs)).toBeNull();
  });
});

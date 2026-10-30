import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, isLoginThrottled, recordLoginFailure, clearLoginFailures } from "./auth-service.js";

describe("password hashing", { timeout: 20000 }, () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong password!!", stored)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same-password-123")).not.toBe(await hashPassword("same-password-123"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe("login throttle", () => {
  it("throttles after 10 failures and clears on success", () => {
    const key = "1.2.3.4|a@b.com";
    for (let i = 0; i < 9; i++) recordLoginFailure(key);
    expect(isLoginThrottled(key)).toBe(false);
    recordLoginFailure(key);
    expect(isLoginThrottled(key)).toBe(true);
    clearLoginFailures(key);
    expect(isLoginThrottled(key)).toBe(false);
  });
});

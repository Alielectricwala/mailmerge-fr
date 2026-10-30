import { describe, it, expect } from "vitest";
import { classifySmtpError } from "./smtp-outcome.js";

describe("classifySmtpError", () => {
  it("treats a 550 at RCPT as a rejected bad address", () => {
    expect(classifySmtpError({ responseCode: 550, command: "RCPT TO", response: "550 5.1.1 no such user" })).toMatchObject({ kind: "rejected", badAddress: true });
  });

  it("treats a 554 policy rejection at DATA as rejected but not a bad address", () => {
    expect(classifySmtpError({ responseCode: 554, command: "DATA", response: "554 5.7.1 message rejected as spam" })).toMatchObject({ kind: "rejected", badAddress: false });
  });

  it("treats a 553 sender login mismatch as rejected but not a bad recipient address", () => {
    expect(
      classifySmtpError({
        responseCode: 553,
        command: "MAIL FROM",
        response: "553 5.7.1 <founderoffice@focusrealm.org>: Sender address rejected: not owned by user namaste@misehotel.com",
      })
    ).toMatchObject({ kind: "rejected", badAddress: false });
  });

  it("treats 4xx as temporary", () => {
    expect(classifySmtpError({ responseCode: 451, command: "RCPT TO", response: "451 try again later" }).kind).toBe("temporary");
  });

  it("treats auth and connection failures as not sent", () => {
    expect(classifySmtpError({ code: "EAUTH", command: "AUTH PLAIN", response: "535 bad credentials" })).toMatchObject({ kind: "not_sent", authFailure: true });
    expect(classifySmtpError({ code: "ECONNECTION", command: "CONN", message: "connect ECONNREFUSED" })).toMatchObject({ kind: "not_sent", authFailure: false });
  });

  it("treats a timeout after handoff as unknown (never auto-retried)", () => {
    expect(classifySmtpError({ code: "ETIMEDOUT", command: "DATA", message: "Timeout" }).kind).toBe("unknown");
    expect(classifySmtpError(new Error("socket hang up")).kind).toBe("unknown");
  });
});

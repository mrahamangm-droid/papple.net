import { describe, expect, it } from "vitest";
import { acceptOutcomeMessage, approvalFailureMessage, approvalNotificationCopy, canDecide, canWithdraw, requestStatusLabel } from "./present";

describe("requestStatusLabel", () => {
  it.each([
    ["pending", "Waiting for an owner"], ["approved", "Approved"], ["rejected", "Rejected"],
    ["withdrawn", "Withdrawn"], ["lapsed", "Lapsed (terms changed)"], ["nope", "Unknown"],
  ])("%s → %s", (s, label) => expect(requestStatusLabel(s)).toBe(label));
});

describe("acceptOutcomeMessage", () => {
  it("explains a request and stays quiet on a plain accept", () => {
    expect(acceptOutcomeMessage("approval_requested")).toBe("Sent to your organization's owners for approval.");
    expect(acceptOutcomeMessage("approval_pending")).toBe("Sent to your organization's owners for approval.");
    expect(acceptOutcomeMessage("accepted")).toBeNull();
    expect(acceptOutcomeMessage(undefined)).toBeNull();
  });
});

describe("approvalNotificationCopy", () => {
  const payload = { contract_id: "c1", request_id: "r1", price: 123456 };
  it("links owners to the queue and requesters to the outcome", () => {
    expect(approvalNotificationCopy("spend_approval_requested", payload)).toEqual({ text: "A contract is waiting for your approval.", href: "/approvals" });
    expect(approvalNotificationCopy("spend_request_approved", payload)).toEqual({ text: "Your contract approval was granted.", href: "/contracts/c1" });
    expect(approvalNotificationCopy("spend_request_rejected", payload)).toEqual({ text: "Your contract approval was declined.", href: "/approvals" });
  });
  it("never shows an amount and ignores other types", () => {
    for (const t of ["spend_approval_requested", "spend_request_approved", "spend_request_rejected"]) expect(approvalNotificationCopy(t, payload)!.text).not.toMatch(/\d/);
    expect(approvalNotificationCopy("contract_active", payload)).toBeNull();
  });
  it("falls back to the queue without a contract id", () => {
    expect(approvalNotificationCopy("spend_request_approved", {})!.href).toBe("/approvals");
  });
});

describe("who may act", () => {
  it("only an owner who is not the requester decides", () => {
    expect(canDecide("owner", "u2", "u1")).toBe(true);
    expect(canDecide("owner", "u1", "u1")).toBe(false);
    expect(canDecide("admin", "u2", "u1")).toBe(false);
  });
  it("the requester or an owner withdraws", () => {
    expect(canWithdraw("admin", "u1", "u1")).toBe(true);
    expect(canWithdraw("owner", "u2", "u1")).toBe(true);
    expect(canWithdraw("admin", "u2", "u1")).toBe(false);
  });
  it("has plain failure messages", () => {
    expect(approvalFailureMessage("forbidden")).toMatch(/not allowed/i);
    expect(approvalFailureMessage("rate")).toMatch(/too many/i);
  });
});

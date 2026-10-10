import { describe, expect, it } from "vitest";
import { acceptOutcomeMessage, approvalFailureMessage, approvalNotificationCopy, approvalProgress, canDecide, canWithdraw, decideOutcomeMessage, policySummary, requestStatusLabel, tierSummary } from "./present";

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
  const ORG = "11111111-1111-4111-8111-111111111111";
  it("links owners to the queue and requesters to the outcome", () => {
    expect(approvalNotificationCopy("spend_approval_requested", payload)).toEqual({ text: "A contract is waiting for your approval.", href: "/approvals" });
    expect(approvalNotificationCopy("spend_request_approved", payload)).toEqual({ text: "Your contract approval was granted.", href: "/contracts/c1" });
    expect(approvalNotificationCopy("spend_request_rejected", payload)).toEqual({ text: "Your contract approval was declined.", href: "/approvals" });
  });
  it("never shows an amount and ignores other types", () => {
    for (const t of ["spend_approval_requested", "spend_request_approved", "spend_request_rejected"]) expect(approvalNotificationCopy(t, payload)!.text).not.toMatch(/\d/);
    expect(approvalNotificationCopy("contract_active", payload)).toBeNull();
  });
  it("opens the queue of the organization the request belongs to", () => {
    expect(approvalNotificationCopy("spend_approval_requested", { ...payload, org_id: ORG })!.href).toBe(`/approvals?org=${ORG}`);
    expect(approvalNotificationCopy("spend_request_rejected", { ...payload, org_id: ORG })!.href).toBe(`/approvals?org=${ORG}`);
    expect(approvalNotificationCopy("spend_approval_requested", { ...payload, org_id: "not-a-uuid" })!.href).toBe("/approvals");
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
    expect(approvalFailureMessage("stale")).toBe("This request was already decided or withdrawn. Refresh the page to see where it stands.");
  });
});

describe("policySummary", () => {
  it("describes an active rule in words", () => {
    expect(policySummary({ enabled: true, threshold_minor: 10000, currency: "USD" }))
      .toBe("Contracts of $100.00 or more, or in a currency other than USD, need an owner's approval when an admin accepts them.");
  });
  it("says when there is no rule or it is switched off", () => {
    expect(policySummary(null)).toBe("No approval rule. Owners and admins accept contracts directly.");
    expect(policySummary({ enabled: false, threshold_minor: 10000, currency: "USD" })).toBe("No approval rule. Owners and admins accept contracts directly.");
  });
});

describe("approval tiers", () => {
  it("tells an owner their accept was only the first approval", () => {
    expect(acceptOutcomeMessage("approval_requested", true)).toBe("Your approval is recorded. Another owner must approve before the contract is accepted.");
    expect(acceptOutcomeMessage("approval_pending", true)).toBe("Your approval is recorded. Another owner must approve before the contract is accepted.");
  });
  it("words a partial decision", () => {
    expect(decideOutcomeMessage("partial")).toBe("Your approval is recorded. Another owner must also approve.");
    expect(decideOutcomeMessage("approved")).toBeNull();
    expect(decideOutcomeMessage("lapsed")).toMatch(/terms changed/);
  });
  it("shows progress and whether it can still complete", () => {
    expect(approvalProgress({ required: 2, approvedBy: ["Ana"], eligibleLeft: 1 })).toEqual({ text: "1 of 2 owner approvals (approved by Ana)", stuck: false });
    expect(approvalProgress({ required: 1, approvedBy: [], eligibleLeft: 2 })).toEqual({ text: "Needs 1 owner approval", stuck: false });
    expect(approvalProgress({ required: 3, approvedBy: ["Ana"], eligibleLeft: 1 })).toEqual({
      text: "1 of 3 owner approvals (approved by Ana). It cannot be completed: not enough owners are left to approve.", stuck: true,
    });
  });
  it("summarizes the tiers", () => {
    expect(tierSummary([{ min_minor: 5000000, approvals: 2 }, { min_minor: 500000, approvals: 1 }], "USD"))
      .toBe("From $5,000.00: 1 owner approval. From $50,000.00: 2 different owners.");
    expect(tierSummary([], "USD")).toBe("One owner approval for every request.");
  });
  it("has copy for a progress notification", () => {
    expect(approvalNotificationCopy("spend_request_progress", {})?.text).toBe("An owner approved your contract; another approval is still needed.");
  });
});

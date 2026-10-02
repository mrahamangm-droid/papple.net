import { describe, expect, it } from "vitest";
import { contractActions, contractStatusLabel, milestoneActions, milestoneStatusLabel, milestoneTotal, notificationCopy, viewerSide } from "./present";

const contract = { client_org_id: "c", provider_org_id: "p" };

describe("viewerSide", () => {
  it("finds which side the viewer is on, with the role", () => {
    expect(viewerSide(contract, [{ id: "c", role: "owner" }])).toEqual({ side: "client", orgId: "c", role: "owner" });
    expect(viewerSide(contract, [{ id: "x", role: "owner" }, { id: "p", role: "member" }])).toEqual({ side: "provider", orgId: "p", role: "member" });
  });
  it("returns null for outsiders", () => {
    expect(viewerSide(contract, [{ id: "x", role: "owner" }])).toBeNull();
    expect(viewerSide(contract, [])).toBeNull();
  });
});

describe("milestoneActions", () => {
  const m = (over: Partial<Parameters<typeof milestoneActions>[0]>) => milestoneActions({ side: "client", role: "owner", contractStatus: "active", milestoneStatus: "submitted", ...over });
  it("lets the client owner approve and ask for changes on a submitted milestone", () => {
    expect(m({})).toEqual({ submit: false, approve: true, requestChanges: true });
  });
  it("shows approve again for an approved but unpaid milestone so payment can be retried", () => {
    expect(m({ milestoneStatus: "approved" })).toEqual({ submit: false, approve: true, requestChanges: false });
  });
  it("never offers payment on a paid milestone", () => {
    expect(m({ milestoneStatus: "paid" })).toEqual({ submit: false, approve: false, requestChanges: false });
  });
  it("lets only the provider submit pending or changes-requested milestones", () => {
    expect(m({ side: "provider", milestoneStatus: "pending" }).submit).toBe(true);
    expect(m({ side: "provider", milestoneStatus: "changes_requested" }).submit).toBe(true);
    expect(m({ side: "provider", milestoneStatus: "submitted" }).submit).toBe(false);
    expect(m({ side: "client", milestoneStatus: "pending" }).submit).toBe(false);
  });
  it("freezes everything on a disputed, draft or completed contract", () => {
    for (const contractStatus of ["disputed", "draft", "completed", "cancelled"]) {
      expect(m({ contractStatus })).toEqual({ submit: false, approve: false, requestChanges: false });
    }
  });
  it("keeps payment approval for owners and admins, not plain members or viewers", () => {
    expect(m({ role: "member" }).approve).toBe(false);
    expect(m({ role: "member" }).requestChanges).toBe(true);
    expect(m({ role: "viewer" })).toEqual({ submit: false, approve: false, requestChanges: false });
    expect(m({ role: "admin" }).approve).toBe(true);
  });
});

describe("contractActions", () => {
  const c = (over: Partial<Parameters<typeof contractActions>[0]>) => contractActions({
    side: "client", role: "owner", contract: { status: "draft", accepted_by_client: false, accepted_by_provider: false }, hasReviewed: false, ...over,
  });
  it("offers edit, accept and cancel on a draft", () => {
    expect(c({})).toMatchObject({ editMilestones: true, accept: true, cancel: true, activate: false, dispute: false, review: false });
  });
  it("stops offering accept once your side accepted", () => {
    expect(c({ contract: { status: "draft", accepted_by_client: true, accepted_by_provider: false } }).accept).toBe(false);
    expect(c({ side: "provider", contract: { status: "draft", accepted_by_client: true, accepted_by_provider: false } }).accept).toBe(true);
  });
  it("offers activation only when both sides accepted", () => {
    expect(c({ contract: { status: "draft", accepted_by_client: true, accepted_by_provider: true } }).activate).toBe(true);
  });
  it("offers dispute on an active contract and nothing on a disputed one", () => {
    expect(c({ contract: { status: "active", accepted_by_client: true, accepted_by_provider: true } })).toMatchObject({ dispute: true, editMilestones: false, cancel: false });
    expect(c({ contract: { status: "disputed", accepted_by_client: true, accepted_by_provider: true } }).dispute).toBe(false);
  });
  it("offers a review only after completion and only once", () => {
    const done = { status: "completed", accepted_by_client: true, accepted_by_provider: true };
    expect(c({ contract: done }).review).toBe(true);
    expect(c({ contract: done, hasReviewed: true }).review).toBe(false);
    expect(c({ contract: done, role: "member" }).review).toBe(false);
  });
});

describe("labels and totals", () => {
  it("has a human label for every status", () => {
    for (const s of ["draft", "active", "completed", "cancelled", "disputed"]) expect(contractStatusLabel(s)).not.toBe(s);
    for (const s of ["pending", "submitted", "changes_requested", "approved", "paid"]) expect(milestoneStatusLabel(s)).not.toBe(s);
    expect(contractStatusLabel("weird")).toBe("Unknown");
  });
  it("sums milestone amounts", () => {
    expect(milestoneTotal([{ amount: 40000 }, { amount: 60000 }])).toBe(100000);
    expect(milestoneTotal([])).toBe(0);
  });
  it("writes neutral notification copy with a contract link and no amounts", () => {
    const n = notificationCopy("milestone_submitted", { contract_id: "abc", amount: 999 });
    expect(n?.href).toBe("/contracts/abc");
    expect(n?.text).not.toMatch(/999/);
    expect(notificationCopy("payment_received", { contract_id: "abc" })?.href).toBe("/contracts/abc");
    expect(notificationCopy("not_a_contract_type", {})).toBeNull();
  });
});

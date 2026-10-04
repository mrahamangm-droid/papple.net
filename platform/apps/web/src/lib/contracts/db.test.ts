import { describe, expect, it, vi } from "vitest";
import { createContractsDb } from "./db";
import { DuplicateError, InvalidInputError, NotAllowedError } from "../marketplace/errors";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const ok = (data: unknown = "id") => vi.fn(async (_fn: string, _a: Record<string, unknown>) => ({ data, error: null }));

describe("createContractsDb", () => {
  it("hires with explicit org and proposal", async () => {
    const rpc = ok(U(9));
    expect(await createContractsDb(rpc).hire({ orgId: U(1), proposalId: U(2) })).toBe(U(9));
    expect(rpc).toHaveBeenCalledWith("create_contract", { p_org: U(1), p_proposal: U(2) });
  });
  it("sends milestones as snake_case json with an explicit org", async () => {
    const rpc = ok();
    await createContractsDb(rpc).setMilestones({ orgId: U(1), contractId: U(2), items: [{ title: "A", description: "d", amount: 5, dueDate: "2026-12-31" }, { title: "B", description: "", amount: 7 }] });
    expect(rpc).toHaveBeenCalledWith("set_milestones", {
      p_org: U(1), p_contract: U(2),
      p_items: [{ title: "A", description: "d", amount: 5, due_date: "2026-12-31" }, { title: "B", description: "", amount: 7, due_date: null }],
    });
  });
  it("uses one rpc per lifecycle step", async () => {
    const rpc = ok();
    const db = createContractsDb(rpc);
    await db.acceptContract(U(1), U(2));
    await db.activateContract(U(2));
    await db.submitMilestone(U(1), U(3));
    await db.requestChanges(U(1), U(3), "note");
    await db.cancelContract(U(1), U(2), "why");
    await db.raiseDispute({ orgId: U(1), contractId: U(2), reason: "long enough reason" });
    await db.postReview({ orgId: U(1), contractId: U(2), rating: 5, comment: "great" });
    await db.assertCanManagePayouts(U(1));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "accept_contract", "activate_contract", "submit_milestone", "request_changes", "cancel_contract", "raise_dispute", "post_review", "assert_can_manage_payouts",
    ]);
  });
  it("returns the approval details from approve_milestone", async () => {
    const approval = { payment_id: U(5), milestone_id: U(3), contract_id: U(2), title: "First", amount: 40000, client_fee: 800, provider_fee: 2000, client_total: 40800, application_fee: 2800, currency: "USD", previous_session: null };
    const rpc = ok(approval);
    expect(await createContractsDb(rpc).approveMilestone(U(1), U(3))).toEqual(approval);
    expect(rpc).toHaveBeenCalledWith("approve_milestone", { p_org: U(1), p_milestone: U(3) });
  });
  it("translates database codes into typed errors", async () => {
    const mk = (code: string) => vi.fn(async () => ({ data: null, error: { code, message: "raw database text" } }));
    await expect(createContractsDb(mk("42501")).activateContract(U(1))).rejects.toBeInstanceOf(NotAllowedError);
    await expect(createContractsDb(mk("22023")).activateContract(U(1))).rejects.toBeInstanceOf(InvalidInputError);
    await expect(createContractsDb(mk("23505")).hire({ orgId: U(1), proposalId: U(2) })).rejects.toBeInstanceOf(DuplicateError);
  });
});

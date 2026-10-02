import { describe, expect, it, vi } from "vitest";
import { createMarketplaceDb } from "./db";
import { LimitError } from "./errors";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const ok = (data: unknown = "id") => vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data, error: null }));

describe("createMarketplaceDb", () => {
  it("submitProposal calls the RPC with explicit org and project", async () => {
    const rpc = ok(U(9));
    const id = await createMarketplaceDb(rpc).submitProposal({ orgId: U(1), projectId: U(2), coverLetter: "hi", price: 1000, currency: "USD", deliveryDays: 7 });
    expect(rpc).toHaveBeenCalledWith("submit_proposal", { p_org: U(1), p_project: U(2), p_cover_letter: "hi", p_price: 1000, p_currency: "USD", p_delivery_days: 7 });
    expect(id).toBe(U(9));
  });
  it("startConversation resolves the target from kind and ref, never from an org id", async () => {
    const rpc = ok();
    await createMarketplaceDb(rpc).startConversation({ fromOrgId: U(1), kind: "service", refId: U(3), firstMessage: "hello" });
    expect(rpc).toHaveBeenCalledWith("start_conversation", { p_from_org: U(1), p_kind: "service", p_ref: U(3), p_first_message: "hello" });
  });
  it("sendMessage, report and setProposalStatus use their RPCs", async () => {
    const rpc = ok();
    const db = createMarketplaceDb(rpc);
    await db.sendMessage({ conversationId: U(4), orgId: U(1), body: "x" });
    await db.report({ kind: "profile", id: U(5), reason: "spam" });
    await db.setProposalStatus(U(6), "shortlisted");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["send_message", "report_content", "set_proposal_status"]);
  });
  it("translates database error codes into typed errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "54000", message: "service limit reached" } }));
    await expect(createMarketplaceDb(rpc).setProjectStatus({ orgId: U(1), id: U(2), status: "open" })).rejects.toBeInstanceOf(LimitError);
  });
});

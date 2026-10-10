import { describe, expect, it, vi } from "vitest";
import { createApprovalsService, type ApprovalsDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const REQ = "33333333-3333-4333-8333-333333333333";
const CON = "44444444-4444-4444-8444-444444444444";
type RpcImpl = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;

function mk(rpcImpl?: RpcImpl, over: Partial<ApprovalsDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: null, error: null })));
  const revalidate = vi.fn();
  const deps: ApprovalsDeps = { getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, ...over };
  return { svc: createApprovalsService(deps), rpc, revalidate };
}
const policy = (amount: string, currency = "USD") => ({ orgId: ORG, enabled: true, amount, currency });

describe("gates", () => {
  it("needs a signed-in user and respects the rate limit", async () => {
    expect(await mk(undefined, { getUserId: async () => null }).svc.setPolicy(policy("100"))).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(undefined, { throttle: async () => false }).svc.setPolicy(policy("100"))).toEqual({ ok: false, code: "rate" });
    expect(await mk(undefined, { throttle: async () => { throw new Error("down"); } }).svc.withdraw({ orgId: ORG, requestId: REQ })).toEqual({ ok: false, code: "error" });
  });
});

describe("setPolicy", () => {
  it.each(["1,000.50", "-5", "1e3", "21474837", "", "10.123", " "])("refuses %j before any call", async (amount) => {
    const { svc, rpc } = mk();
    expect(await svc.setPolicy(policy(amount))).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses decimals the currency does not have", async () => {
    const { svc, rpc } = mk();
    expect(await svc.setPolicy(policy("100.5", "JPY"))).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("converts major units to minor units and normalizes the currency", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.setPolicy(policy("100.5", " usd "))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("spend_policy_set", { p_org: ORG, p_enabled: true, p_threshold: 10050, p_currency: "USD" });
    expect(revalidate).toHaveBeenCalledWith("/settings/approvals");
  });
  it("maps database refusals to codes", async () => {
    expect(await mk(async () => ({ data: null, error: { code: "42501" } })).svc.setPolicy(policy("1"))).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(async () => ({ data: null, error: { code: "22023" } })).svc.setPolicy(policy("1"))).toEqual({ ok: false, code: "invalid" });
    expect(await mk(async () => { throw new Error("net"); }).svc.setPolicy(policy("1"))).toEqual({ ok: false, code: "error" });
  });
});

describe("decide", () => {
  it("needs a note to reject, checked before any call", async () => {
    const { svc, rpc } = mk();
    expect(await svc.decide({ orgId: ORG, requestId: REQ, approve: false, note: "  " })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes the outcome through and refreshes the queue and the contract", async () => {
    const { svc, rpc, revalidate } = mk(async () => ({ data: "lapsed", error: null }));
    expect(await svc.decide({ orgId: ORG, requestId: REQ, contractId: CON, approve: true, note: "" })).toEqual({ ok: true, outcome: "lapsed" });
    expect(rpc).toHaveBeenCalledWith("spend_request_decide", { p_org: ORG, p_request: REQ, p_approve: true, p_note: "" });
    expect(revalidate).toHaveBeenCalledWith("/approvals");
    expect(revalidate).toHaveBeenCalledWith(`/contracts/${CON}`);
  });
  it("reports a request someone else already decided", async () => {
    expect(await mk(async () => ({ data: null, error: { code: "55000" } })).svc.decide({ orgId: ORG, requestId: REQ, approve: true, note: "" })).toEqual({ ok: false, code: "stale" });
    expect(await mk(async () => ({ data: null, error: { code: "55000" } })).svc.withdraw({ orgId: ORG, requestId: REQ })).toEqual({ ok: false, code: "stale" });
  });
  it("treats an unexpected answer as an error", async () => {
    expect(await mk(async () => ({ data: "maybe", error: null })).svc.decide({ orgId: ORG, requestId: REQ, approve: true, note: "" })).toEqual({ ok: false, code: "error" });
  });
});

describe("withdraw", () => {
  it("calls the database and refreshes the queue", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.withdraw({ orgId: ORG, requestId: REQ })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("spend_request_withdraw", { p_org: ORG, p_request: REQ });
    expect(revalidate).toHaveBeenCalledWith("/approvals");
  });
  it("refuses bad ids before any call", async () => {
    const { svc, rpc } = mk();
    expect(await svc.withdraw({ orgId: "x", requestId: REQ })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

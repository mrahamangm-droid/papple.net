import { describe, expect, it, vi } from "vitest";
import { createPaymentsServiceDb } from "./service-db";

const ok = (data: unknown) => vi.fn(async (_fn: string, _a: Record<string, unknown>) => ({ data, error: null }));

describe("createPaymentsServiceDb", () => {
  it("records a succeeded payment with the paid amount and currency", async () => {
    const rpc = ok("recorded");
    const out = await createPaymentsServiceDb(rpc).recordPaymentSucceeded({ paymentId: "p", sessionId: "cs", intentId: "pi", amountTotal: 40800, currency: "USD" });
    expect(out).toBe("recorded");
    expect(rpc).toHaveBeenCalledWith("record_payment_succeeded", { p_payment: "p", p_session: "cs", p_intent: "pi", p_amount: 40800, p_currency: "USD" });
  });
  it("resolves the payout destination and attaches sessions", async () => {
    const rpc = ok("acct_1");
    const db = createPaymentsServiceDb(rpc);
    expect(await db.paymentDestination("p")).toBe("acct_1");
    await db.attachCheckoutSession("p", "cs", "cs_prev");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["payment_destination", "attach_checkout_session"]);
    expect(rpc).toHaveBeenCalledWith("attach_checkout_session", { p_payment: "p", p_session: "cs", p_prev: "cs_prev" });
  });
  it("registers accounts and records account updates", async () => {
    const rpc = ok(true);
    const db = createPaymentsServiceDb(rpc);
    await db.registerConnectedAccount("org", "acct_1");
    await db.recordAccountUpdate("acct_1", true, false);
    expect(rpc).toHaveBeenCalledWith("register_connected_account", { p_org: "org", p_account: "acct_1" });
    expect(rpc).toHaveBeenCalledWith("record_account_update", { p_account: "acct_1", p_payouts: true, p_details: false });
  });
  it("scopes a failure to the session it belongs to", async () => {
    const rpc = ok("ignored");
    await createPaymentsServiceDb(rpc).recordPaymentFailed("p", "cs_1");
    expect(rpc).toHaveBeenCalledWith("record_payment_failed", { p_payment: "p", p_session: "cs_1" });
  });
  it("looks up an organization's payout account", async () => {
    const rpc = ok("acct_9");
    expect(await createPaymentsServiceDb(rpc).payoutAccount("org")).toBe("acct_9");
    expect(rpc).toHaveBeenCalledWith("payout_account", { p_org: "org" });
  });
  it("throws on database errors so the webhook can be retried", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "XX000", message: "boom" } }));
    await expect(createPaymentsServiceDb(rpc).recordPaymentFailed("p", "cs")).rejects.toThrow("boom");
  });
});

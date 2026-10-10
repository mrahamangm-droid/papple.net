import { describe, expect, it, vi } from "vitest";
import { createPaymentsServiceDb } from "./service-db";

const ok = (data: unknown) => vi.fn(async (_fn: string, _a: Record<string, unknown>) => ({ data, error: null }));

describe("createPaymentsServiceDb", () => {
  it("routes booking payments to their own functions", async () => {
    const rpc = ok(true);
    const db = createPaymentsServiceDb(rpc);
    await db.bookingDestination("p");
    await db.bookingAttachCheckout("p", "cs", null);
    await db.bookingRecordRefundFailed("p", "declined");
    expect(rpc.mock.calls).toEqual([
      ["booking_payment_destination", { p_payment: "p" }],
      ["booking_attach_checkout", { p_payment: "p", p_session: "cs", p_prev: null }],
      ["booking_record_refund_failed", { p_payment: "p", p_reason: "declined" }],
    ]);
  });
  it("returns the one queued booking refund, or null", async () => {
    const row = { payment_id: "p", payment_intent_id: "pi", amount: 10200, currency: "USD", idempotency_key: "booking-refund-p" };
    expect(await createPaymentsServiceDb(ok([row])).bookingRefundToSend("b")).toEqual({ paymentId: "p", paymentIntentId: "pi", amount: 10200, currency: "USD", idempotencyKey: "booking-refund-p" });
    expect(await createPaymentsServiceDb(ok([])).bookingRefundToSend("b")).toBeNull();
  });
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
  it("lists pending refunds as camelCase rows", async () => {
    const rpc = ok([{ payment_id: "p1", payment_intent_id: "pi_1", amount: 20400, currency: "USD", idempotency_key: "refund:p1" }]);
    expect(await createPaymentsServiceDb(rpc).listPendingRefunds("d1")).toEqual([
      { paymentId: "p1", paymentIntentId: "pi_1", amount: 20400, currency: "USD", idempotencyKey: "refund:p1" },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_pending_refunds", { p_dispute: "d1" });
  });
  it("records refund outcomes", async () => {
    const rpc = ok("recorded");
    const db = createPaymentsServiceDb(rpc);
    expect(await db.recordRefundSucceeded({ paymentId: "p1", refundId: "re_1", amount: 20400, currency: "USD" })).toBe("recorded");
    await db.recordRefundFailed("p1", "network");
    expect(rpc).toHaveBeenCalledWith("record_refund_succeeded", { p_payment: "p1", p_refund: "re_1", p_amount: 20400, p_currency: "USD" });
    expect(rpc).toHaveBeenCalledWith("record_refund_failed", { p_payment: "p1", p_reason: "network" });
  });
});

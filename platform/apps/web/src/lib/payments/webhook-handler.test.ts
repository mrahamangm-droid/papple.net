import { describe, expect, it, vi } from "vitest";
import { createMemoryWebhookStore } from "../webhooks";
import { createWebhookHandler } from "./webhook-handler";
import type { PaymentProvider, ProviderEvent } from "./provider";

const PAID: ProviderEvent = { kind: "payment_succeeded", id: "evt_1", paymentId: "p1", sessionId: "cs_1", intentId: "pi_1", amountTotal: 40800, currency: "USD" };

function setup(event: ProviderEvent | Error, dbResult: string = "recorded") {
  const provider = { parseWebhook: vi.fn(() => { if (event instanceof Error) throw event; return event; }) } as unknown as PaymentProvider;
  const db = {
    recordPaymentSucceeded: vi.fn(async () => dbResult),
    recordPaymentFailed: vi.fn(async () => "failed"),
    recordAccountUpdate: vi.fn(async () => true),
    recordRefundSucceeded: vi.fn(async () => dbResult),
    recordSubscription: vi.fn(async () => dbResult),
  };
  const alert = vi.fn();
  const handler = createWebhookHandler({ provider, store: createMemoryWebhookStore(), db, alert });
  return { handler, db, alert, provider };
}

describe("webhook handler", () => {
  it("rejects a missing signature without touching anything", async () => {
    const { handler, db, provider } = setup(PAID);
    expect((await handler("{}", null)).status).toBe(400);
    expect(provider.parseWebhook).not.toHaveBeenCalled();
    expect(db.recordPaymentSucceeded).not.toHaveBeenCalled();
  });
  it("rejects an invalid signature", async () => {
    const { handler, db } = setup(new Error("bad signature"));
    expect((await handler("{}", "t=1,v1=x")).status).toBe(400);
    expect(db.recordPaymentSucceeded).not.toHaveBeenCalled();
  });
  it("records a payment once and ignores a replay of the same event", async () => {
    const { handler, db } = setup(PAID);
    expect((await handler("{}", "sig")).status).toBe(200);
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(db.recordPaymentSucceeded).toHaveBeenCalledTimes(1);
    expect(db.recordPaymentSucceeded).toHaveBeenCalledWith({ paymentId: "p1", sessionId: "cs_1", intentId: "pi_1", amountTotal: 40800, currency: "USD" });
  });
  it("applies account updates", async () => {
    const { handler, db } = setup({ kind: "account_updated", id: "evt_a", accountId: "acct_1", payoutsEnabled: true, detailsSubmitted: true });
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(db.recordAccountUpdate).toHaveBeenCalledWith("acct_1", true, true);
  });
  it("acknowledges an update for an unknown account without error", async () => {
    const { handler, db } = setup({ kind: "account_updated", id: "evt_b", accountId: "acct_zzz", payoutsEnabled: true, detailsSubmitted: true });
    db.recordAccountUpdate.mockResolvedValue(false);
    expect((await handler("{}", "sig")).status).toBe(200);
  });
  it("records failed payments", async () => {
    const { handler, db } = setup({ kind: "payment_failed", id: "evt_f", paymentId: "p2", sessionId: "cs_2" });
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(db.recordPaymentFailed).toHaveBeenCalledWith("p2", "cs_2");
  });
  it("acknowledges unknown event types and writes nothing", async () => {
    const { handler, db } = setup({ kind: "ignored", id: "evt_x", type: "customer.created" });
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(db.recordPaymentSucceeded).not.toHaveBeenCalled();
    expect(db.recordPaymentFailed).not.toHaveBeenCalled();
    expect(db.recordAccountUpdate).not.toHaveBeenCalled();
  });
  it("returns 500 and lets the provider retry when the database fails", async () => {
    const { handler, db } = setup(PAID);
    db.recordPaymentSucceeded.mockRejectedValueOnce(new Error("db down"));
    expect((await handler("{}", "sig")).status).toBe(500);
    expect((await handler("{}", "sig")).status).toBe(200); // retry is not mistaken for a duplicate
    expect(db.recordPaymentSucceeded).toHaveBeenCalledTimes(2);
  });
  it.each(["mismatch", "duplicate_charge", "unknown"])("raises an alert but acknowledges when the database says %s", async (result) => {
    const { handler, alert } = setup(PAID, result);
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(alert.mock.calls[0])).not.toContain("sig");
  });
  it("does not alert for a plain duplicate", async () => {
    const { handler, alert } = setup(PAID, "duplicate");
    await handler("{}", "sig");
    expect(alert).not.toHaveBeenCalled();
  });
  describe("refunds", () => {
    const REFUND: ProviderEvent = { kind: "refund_succeeded", id: "evt_r", paymentId: "p1", refundId: "re_1", amount: 20400, currency: "USD" };
    it("finalizes a refund once and ignores a replay", async () => {
      const { handler, db } = setup(REFUND, "recorded");
      expect((await handler("{}", "sig")).status).toBe(200);
      expect((await handler("{}", "sig")).status).toBe(200);
      expect(db.recordRefundSucceeded).toHaveBeenCalledTimes(1);
      expect(db.recordRefundSucceeded).toHaveBeenCalledWith({ paymentId: "p1", refundId: "re_1", amount: 20400, currency: "USD" });
    });
    it("raises an alert for a refund that does not match the payment, and still acknowledges it", async () => {
      const { handler, alert } = setup(REFUND, "mismatch");
      expect((await handler("{}", "sig")).status).toBe(200);
      expect(alert).toHaveBeenCalledWith("payment webhook outcome: mismatch", { eventId: "evt_r", paymentId: "p1" });
    });
    it("alerts on a refund nobody queued", async () => {
      const { handler, alert } = setup(REFUND, "unknown");
      await handler("{}", "sig");
      expect(alert).toHaveBeenCalledTimes(1);
    });
    it("returns 500 so Stripe retries when the database fails", async () => {
      const { handler, db } = setup(REFUND);
      db.recordRefundSucceeded.mockRejectedValueOnce(new Error("db"));
      expect((await handler("{}", "sig")).status).toBe(500);
    });
  });
  it("alerts when money arrives on a cancelled contract, and still acknowledges the event", async () => {
    const { handler, alert } = setup(PAID, "paid_on_cancelled");
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(alert).toHaveBeenCalledWith("payment webhook outcome: paid_on_cancelled", { eventId: "evt_1", paymentId: "p1" });
  });

  const SUB: ProviderEvent = { kind: "subscription_changed", id: "evt_s", orgId: "o1", customerId: "cus_1", subscriptionId: "sub_1", priceId: "price_pro", status: "active", periodEnd: "2026-11-01T00:00:00.000Z", cancelAtPeriodEnd: false, eventAt: "2026-10-01T00:00:00.000Z" };
  it("records a subscription change once and ignores a replay", async () => {
    const { handler, db } = setup(SUB, "applied");
    expect((await handler("{}", "sig")).status).toBe(200);
    expect((await handler("{}", "sig")).status).toBe(200);
    expect(db.recordSubscription).toHaveBeenCalledTimes(1);
    expect(db.recordSubscription).toHaveBeenCalledWith({ orgId: "o1", customerId: "cus_1", subscriptionId: "sub_1", priceId: "price_pro", status: "active", periodEnd: "2026-11-01T00:00:00.000Z", cancelAtPeriodEnd: false, eventAt: "2026-10-01T00:00:00.000Z" });
  });
  it("alerts when a subscription cannot be matched, but still acknowledges it", async () => {
    for (const outcome of ["unknown_org", "unknown_plan", "conflict"]) {
      const { handler, alert } = setup(SUB, outcome);
      expect((await handler("{}", "sig")).status).toBe(200);
      expect(alert).toHaveBeenCalledTimes(1);
    }
  });
  it("does not alert for applied or stale subscription events", async () => {
    for (const outcome of ["applied", "stale"]) {
      const { handler, alert } = setup(SUB, outcome);
      await handler("{}", "sig");
      expect(alert).not.toHaveBeenCalled();
    }
  });
  it("asks Stripe to retry when recording a subscription fails", async () => {
    const { handler, db } = setup(SUB);
    db.recordSubscription.mockRejectedValueOnce(new Error("db down"));
    expect((await handler("{}", "sig")).status).toBe(500);
  });
});

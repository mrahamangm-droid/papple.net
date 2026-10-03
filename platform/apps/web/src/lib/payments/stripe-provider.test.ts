import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { createStripeProvider, type StripeLike } from "./stripe-provider";

const SECRET = "whsec_test_secret";
interface CheckoutParams {
  mode: string; metadata: unknown; expires_at: number;
  line_items: { price_data: Record<string, unknown> }[];
  payment_intent_data: Record<string, unknown>;
}
const PAY = "11111111-1111-4111-8111-111111111111";

function realProvider() {
  const stripe = new Stripe("sk_test_dummy");
  return { stripe, provider: createStripeProvider(stripe as unknown as StripeLike, SECRET) };
}
function signed(stripe: Stripe, event: unknown, secret = SECRET) {
  const payload = JSON.stringify(event);
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}
const completed = (over: Record<string, unknown> = {}) => ({
  id: "evt_1", object: "event", type: "checkout.session.completed",
  data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 40800, currency: "usd", payment_intent: "pi_1", metadata: { payment_id: PAY }, ...over } },
});

describe("parseWebhook", () => {
  it("normalizes a paid checkout session", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, completed());
    expect(provider.parseWebhook(payload, header)).toEqual({
      kind: "payment_succeeded", id: "evt_1", paymentId: PAY, sessionId: "cs_1", intentId: "pi_1", amountTotal: 40800, currency: "USD",
    });
  });
  it("ignores a session that is not paid yet", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, completed({ payment_status: "unpaid" }));
    expect(provider.parseWebhook(payload, header).kind).toBe("ignored");
  });
  it("ignores a paid session that carries no payment id", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, completed({ metadata: {} }));
    expect(provider.parseWebhook(payload, header).kind).toBe("ignored");
  });
  it("maps expired sessions to a failed payment", () => {
    const { stripe, provider } = realProvider();
    const ev = { ...completed(), id: "evt_2", type: "checkout.session.expired" };
    const { payload, header } = signed(stripe, ev);
    expect(provider.parseWebhook(payload, header)).toEqual({ kind: "payment_failed", id: "evt_2", paymentId: PAY, sessionId: "cs_1" });
  });
  it("normalizes account updates", () => {
    const { stripe, provider } = realProvider();
    const ev = { id: "evt_3", object: "event", type: "account.updated", data: { object: { id: "acct_1", object: "account", payouts_enabled: true, details_submitted: true } } };
    const { payload, header } = signed(stripe, ev);
    expect(provider.parseWebhook(payload, header)).toEqual({ kind: "account_updated", id: "evt_3", accountId: "acct_1", payoutsEnabled: true, detailsSubmitted: true });
  });
  it("ignores unknown event types", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, { id: "evt_4", object: "event", type: "customer.created", data: { object: {} } });
    expect(provider.parseWebhook(payload, header)).toEqual({ kind: "ignored", id: "evt_4", type: "customer.created" });
  });
  it("rejects a tampered body", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, completed());
    expect(() => provider.parseWebhook(payload.replace("40800", "1"), header)).toThrow();
  });
  it("rejects a signature made with another secret", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, completed(), "whsec_other");
    expect(() => provider.parseWebhook(payload, header)).toThrow();
  });
});

describe("webhook secrets", () => {
  it("accepts a signature made with the Connect endpoint secret", () => {
    const stripe = new Stripe("sk_test_dummy");
    const provider = createStripeProvider(stripe as unknown as StripeLike, [SECRET, "whsec_connect"]);
    const ev = { id: "evt_c", object: "event", type: "account.updated", data: { object: { id: "acct_1", object: "account", payouts_enabled: true, details_submitted: true } } };
    const { payload, header } = signed(stripe, ev, "whsec_connect");
    expect(provider.parseWebhook(payload, header).kind).toBe("account_updated");
  });
  it("still rejects a secret that is not configured", () => {
    const stripe = new Stripe("sk_test_dummy");
    const provider = createStripeProvider(stripe as unknown as StripeLike, [SECRET, "whsec_connect"]);
    const { payload, header } = signed(stripe, completed(), "whsec_unknown");
    expect(() => provider.parseWebhook(payload, header)).toThrow();
  });
});

describe("expireCheckout", () => {
  const make = (expire: () => Promise<unknown>, retrieve: () => Promise<{ status?: string | null }>) =>
    createStripeProvider({ checkout: { sessions: { create: vi.fn(), expire, retrieve } } } as unknown as StripeLike, SECRET);
  it("expires an open session", async () => {
    expect(await make(async () => ({}), async () => ({ status: "open" })).expireCheckout("cs_1")).toBe("expired");
  });
  it("reports a session that was already paid instead of hiding the failure", async () => {
    const p = make(async () => { throw new Error("only open sessions can be expired"); }, async () => ({ status: "complete" }));
    expect(await p.expireCheckout("cs_1")).toBe("complete");
  });
  it("treats a session that expired on its own as expired", async () => {
    const p = make(async () => { throw new Error("already expired"); }, async () => ({ status: "expired" }));
    expect(await p.expireCheckout("cs_1")).toBe("expired");
  });
  it("rethrows when the state cannot be established", async () => {
    const p = make(async () => { throw new Error("network"); }, async () => ({ status: "open" }));
    await expect(p.expireCheckout("cs_1")).rejects.toThrow("network");
  });
});

describe("createCheckout", () => {
  it("creates a destination charge with the application fee and the payment id", async () => {
    const create = vi.fn(async (_p: Record<string, unknown>) => ({ id: "cs_9", url: "https://checkout.example/cs_9" }));
    const provider = createStripeProvider({ checkout: { sessions: { create, expire: vi.fn() } } } as unknown as StripeLike, SECRET, () => 1_700_000_000_000);
    const out = await provider.createCheckout({ paymentId: PAY, totalMinor: 40800, applicationFeeMinor: 2800, currency: "USD", destinationAccount: "acct_9", title: "First", successUrl: "https://x/ok", cancelUrl: "https://x/no", expiresInMinutes: 60 });
    expect(out).toEqual({ sessionId: "cs_9", url: "https://checkout.example/cs_9" });
    const p = create.mock.calls[0]![0] as unknown as CheckoutParams;
    expect(p.mode).toBe("payment");
    expect(p.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 40800 });
    expect(p.payment_intent_data).toMatchObject({ application_fee_amount: 2800, transfer_data: { destination: "acct_9" }, metadata: { payment_id: PAY } });
    expect(p.metadata).toEqual({ payment_id: PAY });
    expect(p.expires_at).toBe(1_700_000_000 + 3600);
  });
  it("never asks Stripe for less than its 30 minute minimum expiry", async () => {
    const create = vi.fn(async (_p: Record<string, unknown>) => ({ id: "cs", url: "https://c" }));
    const provider = createStripeProvider({ checkout: { sessions: { create, expire: vi.fn() } } } as unknown as StripeLike, SECRET, () => 0);
    await provider.createCheckout({ paymentId: PAY, totalMinor: 1, applicationFeeMinor: 0, currency: "USD", destinationAccount: "a", title: "t", successUrl: "https://x", cancelUrl: "https://x", expiresInMinutes: 5 });
    expect((create.mock.calls[0]![0] as unknown as CheckoutParams).expires_at).toBe(31 * 60);
  });
  it("fails when Stripe returns no checkout url", async () => {
    const provider = createStripeProvider({ checkout: { sessions: { create: async () => ({ id: "cs", url: null }), expire: vi.fn() } } } as unknown as StripeLike, SECRET);
    await expect(provider.createCheckout({ paymentId: PAY, totalMinor: 1, applicationFeeMinor: 0, currency: "USD", destinationAccount: "a", title: "t", successUrl: "https://x", cancelUrl: "https://x", expiresInMinutes: 60 })).rejects.toThrow();
  });
});

describe("onboarding", () => {
  it("creates an Express account when none exists, then a link", async () => {
    const accountsCreate = vi.fn(async (_p: Record<string, unknown>) => ({ id: "acct_new" }));
    const linksCreate = vi.fn(async (_p: Record<string, unknown>) => ({ url: "https://connect.example/onboard" }));
    const provider = createStripeProvider({ accounts: { create: accountsCreate }, accountLinks: { create: linksCreate } } as unknown as StripeLike, SECRET);
    const out = await provider.createOnboardingLink({ returnUrl: "https://x/r", refreshUrl: "https://x/f" });
    expect(out).toEqual({ account: "acct_new", url: "https://connect.example/onboard" });
    expect(accountsCreate.mock.calls[0]![0]).toMatchObject({ type: "express" });
    expect(linksCreate.mock.calls[0]![0]).toMatchObject({ account: "acct_new", type: "account_onboarding" });
  });
  it("reuses an existing account", async () => {
    const accountsCreate = vi.fn();
    const linksCreate = vi.fn(async (_p: Record<string, unknown>) => ({ url: "https://u" }));
    const provider = createStripeProvider({ accounts: { create: accountsCreate }, accountLinks: { create: linksCreate } } as unknown as StripeLike, SECRET);
    const out = await provider.createOnboardingLink({ account: "acct_old", returnUrl: "https://x/r", refreshUrl: "https://x/f" });
    expect(out.account).toBe("acct_old");
    expect(accountsCreate).not.toHaveBeenCalled();
  });
});

describe("refundPayment", () => {
  const input = { paymentId: PAY, paymentIntentId: "pi_1", amountMinor: 20400, currency: "USD", idempotencyKey: `refund:${PAY}` };
  it("refunds the whole charge, returns the application fee and reverses the transfer", async () => {
    const create = vi.fn(async (_p: Record<string, unknown>, _o: { idempotencyKey: string }) => ({ id: "re_1" }));
    const provider = createStripeProvider({ refunds: { create } } as unknown as StripeLike, SECRET);
    expect(await provider.refundPayment(input)).toEqual({ refundId: "re_1" });
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 20400, refund_application_fee: true, reverse_transfer: true, metadata: { payment_id: PAY } },
      { idempotencyKey: `refund:${PAY}` },
    );
  });
  it.each([0, -5, 12.5, Number.NaN])("refuses an invalid amount (%s) without calling Stripe", async (amountMinor) => {
    const create = vi.fn();
    const provider = createStripeProvider({ refunds: { create } } as unknown as StripeLike, SECRET);
    await expect(provider.refundPayment({ ...input, amountMinor })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses a missing payment intent", async () => {
    const create = vi.fn();
    const provider = createStripeProvider({ refunds: { create } } as unknown as StripeLike, SECRET);
    await expect(provider.refundPayment({ ...input, paymentIntentId: "" })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("lets a Stripe failure propagate", async () => {
    const provider = createStripeProvider({ refunds: { create: async () => { throw new Error("insufficient balance"); } } } as unknown as StripeLike, SECRET);
    await expect(provider.refundPayment(input)).rejects.toThrow("insufficient balance");
  });
});

describe("refund webhooks", () => {
  const refundEvent = (type: string, over: Record<string, unknown> = {}) => ({
    id: "evt_r", object: "event", type,
    data: { object: { id: "re_1", object: "refund", status: "succeeded", amount: 20400, currency: "usd", metadata: { payment_id: PAY }, ...over } },
  });
  it.each(["refund.created", "refund.updated"])("normalizes a succeeded refund from %s", (type) => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, refundEvent(type));
    expect(provider.parseWebhook(payload, header)).toEqual({ kind: "refund_succeeded", id: "evt_r", paymentId: PAY, refundId: "re_1", amount: 20400, currency: "USD" });
  });
  it("ignores a refund that has not succeeded", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, refundEvent("refund.updated", { status: "pending" }));
    expect(provider.parseWebhook(payload, header).kind).toBe("ignored");
  });
  it("ignores a refund that carries no payment id", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, refundEvent("refund.created", { metadata: {} }));
    expect(provider.parseWebhook(payload, header).kind).toBe("ignored");
  });
});

describe("subscription events", () => {
  const ORG = "22222222-2222-4222-8222-222222222222";
  const sub = (type: string, over: Record<string, unknown> = {}) => ({
    id: "evt_s1", object: "event", type, created: 1_790_000_000,
    data: { object: {
      id: "sub_1", object: "subscription", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: { org_id: ORG },
      items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_792_000_000 }] }, ...over,
    } },
  });
  it("normalizes an updated subscription", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, sub("customer.subscription.updated", { cancel_at_period_end: true }));
    expect(provider.parseWebhook(payload, header)).toEqual({
      kind: "subscription_changed", id: "evt_s1", orgId: ORG, customerId: "cus_1", subscriptionId: "sub_1", priceId: "price_pro", status: "active",
      periodEnd: new Date(1_792_000_000 * 1000).toISOString(), cancelAtPeriodEnd: true, eventAt: new Date(1_790_000_000 * 1000).toISOString(),
    });
  });
  it("treats a deleted subscription as canceled", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, sub("customer.subscription.deleted", { status: "active" }));
    expect(provider.parseWebhook(payload, header)).toMatchObject({ kind: "subscription_changed", status: "canceled" });
  });
  it("reads the period end from the subscription when the item has none", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, sub("customer.subscription.created", { current_period_end: 1_793_000_000, items: { data: [{ price: { id: "price_pro" } }] } }));
    expect(provider.parseWebhook(payload, header)).toMatchObject({ periodEnd: new Date(1_793_000_000 * 1000).toISOString() });
  });
  it("ignores subscriptions without an organization id, a price or a customer", () => {
    const { stripe, provider } = realProvider();
    for (const over of [{ metadata: {} }, { metadata: { org_id: "not-a-uuid" } }, { items: { data: [] } }, { customer: null }]) {
      const { payload, header } = signed(stripe, sub("customer.subscription.updated", over));
      expect(provider.parseWebhook(payload, header).kind).toBe("ignored");
    }
  });
  it("accepts an expanded customer object", () => {
    const { stripe, provider } = realProvider();
    const { payload, header } = signed(stripe, sub("customer.subscription.updated", { customer: { id: "cus_x" } }));
    expect(provider.parseWebhook(payload, header)).toMatchObject({ customerId: "cus_x" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { createStripeBilling } from "./billing-provider";

function fake() {
  const create = vi.fn(async (_p: Record<string, unknown>, _o?: Record<string, unknown>) => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }));
  const portal = vi.fn(async (_p: Record<string, unknown>) => ({ url: "https://billing.stripe.com/p/session/x" }));
  return { create, portal, billing: createStripeBilling({ checkout: { sessions: { create } }, billingPortal: { sessions: { create: portal } } }) };
}

describe("billing provider", () => {
  it("creates a subscription checkout tagged with the organization", async () => {
    const { billing, create } = fake();
    const r = await billing.createSubscriptionCheckout({ orgId: "org-1", priceId: "price_pro", successUrl: "https://a/s", cancelUrl: "https://a/c" });
    expect(r).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(create.mock.calls[0]![0]).toMatchObject({
      mode: "subscription", client_reference_id: "org-1", metadata: { org_id: "org-1" },
      subscription_data: { metadata: { org_id: "org-1" } }, line_items: [{ price: "price_pro", quantity: 1 }],
      success_url: "https://a/s", cancel_url: "https://a/c",
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("customer");
  });
  it("reuses an existing customer instead of creating a second one", async () => {
    const { billing, create } = fake();
    await billing.createSubscriptionCheckout({ orgId: "org-1", priceId: "price_pro", customerId: "cus_1", successUrl: "https://a/s", cancelUrl: "https://a/c" });
    expect(create.mock.calls[0]![0]).toMatchObject({ customer: "cus_1" });
  });
  it("passes the idempotency key to Stripe as a request option, not a parameter", async () => {
    const { billing, create } = fake();
    await billing.createSubscriptionCheckout({ orgId: "org-1", priceId: "price_pro", idempotencyKey: "k1", successUrl: "https://a/s", cancelUrl: "https://a/c" });
    expect(create.mock.calls[0]![1]).toEqual({ idempotencyKey: "k1" });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("idempotencyKey");
  });
  it("opens the customer portal and returns only the url", async () => {
    const { billing, portal } = fake();
    expect(await billing.createPortalSession({ customerId: "cus_1", returnUrl: "https://a/r" })).toEqual({ url: "https://billing.stripe.com/p/session/x" });
    expect(portal.mock.calls[0]![0]).toEqual({ customer: "cus_1", return_url: "https://a/r" });
  });
  it("fails without a url", async () => {
    const billing = createStripeBilling({ checkout: { sessions: { create: async () => ({ id: "cs", url: null }) } }, billingPortal: { sessions: { create: async () => ({ url: "" }) } } });
    await expect(billing.createSubscriptionCheckout({ orgId: "o", priceId: "p", successUrl: "https://a/s", cancelUrl: "https://a/c" })).rejects.toThrow();
    await expect(billing.createPortalSession({ customerId: "c", returnUrl: "https://a/r" })).rejects.toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createBillingService, type BillingDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const PLAN = { key: "business", active: true, stripePriceId: "price_biz" };

function deps(over: Partial<BillingDeps> = {}): BillingDeps {
  return {
    getUserId: async () => "u1",
    throttle: async () => true,
    canManageBilling: async () => true,
    loadPlan: async (k) => (k === "business" ? PLAN : k === "free" ? { key: "free", active: true, stripePriceId: null } : null),
    loadSubscription: async () => null,
    billing: {
      createSubscriptionCheckout: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay_1" })),
      createPortalSession: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session_1" })),
    },
    siteUrl: "https://papple.net",
    ...over,
  };
}

describe("startCheckout", () => {
  it("creates a checkout for an owner and returns the Stripe url", async () => {
    const d = deps();
    const r = await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" });
    expect(r).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay_1" });
    expect(d.billing!.createSubscriptionCheckout).toHaveBeenCalledWith({
      orgId: ORG, priceId: "price_biz", customerId: null, idempotencyKey: expect.stringMatching(/^checkout:11111111-1111-4111-8111-111111111111:business:\d+$/),
      successUrl: "https://papple.net/settings/billing?checkout=success", cancelUrl: "https://papple.net/settings/billing?checkout=cancelled",
    });
  });
  it("refuses signed-out callers and non-owners", async () => {
    expect(await createBillingService(deps({ getUserId: async () => null })).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "forbidden" });
    const d = deps({ canManageBilling: async () => false });
    expect(await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "forbidden" });
    expect(d.billing!.createSubscriptionCheckout).not.toHaveBeenCalled();
  });
  it("rejects bad input before touching anything", async () => {
    const d = deps();
    const s = createBillingService(d);
    expect(await s.startCheckout({ orgId: "nope", planKey: "business" })).toEqual({ ok: false, code: "invalid" });
    expect(await s.startCheckout({ orgId: ORG, planKey: "" })).toEqual({ ok: false, code: "invalid" });
    expect(await s.startCheckout(null)).toEqual({ ok: false, code: "invalid" });
  });
  it("rate limits", async () => {
    expect(await createBillingService(deps({ throttle: async () => false })).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "rate" });
    expect(await createBillingService(deps({ throttle: async () => { throw new Error("redis down"); } })).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "unavailable" });
  });
  it("refuses unknown, inactive, free and price-less plans", async () => {
    const s = (p: BillingDeps["loadPlan"]) => createBillingService(deps({ loadPlan: p })).startCheckout({ orgId: ORG, planKey: "business" });
    expect(await s(async () => null)).toEqual({ ok: false, code: "invalid" });
    expect(await s(async () => ({ ...PLAN, active: false }))).toEqual({ ok: false, code: "invalid" });
    expect(await s(async () => ({ ...PLAN, stripePriceId: null }))).toEqual({ ok: false, code: "invalid" });
    expect(await createBillingService(deps()).startCheckout({ orgId: ORG, planKey: "free" })).toEqual({ ok: false, code: "invalid" });
  });
  it("is unavailable when Stripe billing is not configured", async () => {
    expect(await createBillingService(deps({ billing: null })).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "unavailable" });
  });
  it("sends an organization that already has a live subscription to the portal, never a second subscription", async () => {
    const d = deps({ loadSubscription: async () => ({ status: "active", customerId: "cus_1" }) });
    const r = await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" });
    expect(r).toEqual({ ok: true, url: "https://billing.stripe.com/p/session_1" });
    expect(d.billing!.createSubscriptionCheckout).not.toHaveBeenCalled();
  });
  it("uses one idempotency key for a double click and a new one half an hour later", async () => {
    const keys: string[] = [];
    const mk = (now: number) => deps({ now: () => now, billing: { createSubscriptionCheckout: async (i) => { keys.push(i.idempotencyKey!); return { url: "https://checkout.stripe.com/c/x" }; }, createPortalSession: async () => ({ url: "" }) } });
    await createBillingService(mk(1_000_000)).startCheckout({ orgId: ORG, planKey: "business" });
    await createBillingService(mk(1_000_500)).startCheckout({ orgId: ORG, planKey: "business" });
    await createBillingService(mk(1_000_000 + 31 * 60_000)).startCheckout({ orgId: ORG, planKey: "business" });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
  it("reuses the Stripe customer after a cancelled subscription", async () => {
    const d = deps({ loadSubscription: async () => ({ status: "canceled", customerId: "cus_1" }) });
    await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" });
    expect(d.billing!.createSubscriptionCheckout).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_1" }));
  });
  it("rejects a returned url that is not https on a Stripe host", async () => {
    for (const url of ["http://checkout.stripe.com/x", "https://evil.example/x", "https://checkout.stripe.com.evil.example/x", "javascript:alert(1)"]) {
      const d = deps({ billing: { createSubscriptionCheckout: async () => ({ url }), createPortalSession: async () => ({ url }) } });
      expect(await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "error" });
    }
  });
  it("turns provider failures into a generic error", async () => {
    const d = deps({ billing: { createSubscriptionCheckout: async () => { throw new Error("secret detail"); }, createPortalSession: async () => ({ url: "" }) } });
    expect(await createBillingService(d).startCheckout({ orgId: ORG, planKey: "business" })).toEqual({ ok: false, code: "error" });
  });
});

describe("openPortal", () => {
  it("opens the portal for an owner with a customer", async () => {
    const d = deps({ loadSubscription: async () => ({ status: "past_due", customerId: "cus_1" }) });
    expect(await createBillingService(d).openPortal({ orgId: ORG })).toEqual({ ok: true, url: "https://billing.stripe.com/p/session_1" });
    expect(d.billing!.createPortalSession).toHaveBeenCalledWith({ customerId: "cus_1", returnUrl: "https://papple.net/settings/billing" });
  });
  it("is invalid when the organization never subscribed, and forbidden for non-owners", async () => {
    expect(await createBillingService(deps()).openPortal({ orgId: ORG })).toEqual({ ok: false, code: "invalid" });
    expect(await createBillingService(deps({ canManageBilling: async () => false })).openPortal({ orgId: ORG })).toEqual({ ok: false, code: "forbidden" });
  });
});

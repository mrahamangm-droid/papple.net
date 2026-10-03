/** Subscription billing on the platform Stripe account. Kept apart from the milestone-payment provider (Connect). */
export interface BillingProvider {
  createSubscriptionCheckout(i: { orgId: string; priceId: string; customerId?: string | null; idempotencyKey?: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortalSession(i: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

/** The slice of the Stripe SDK billing uses. */
export interface StripeBillingLike {
  checkout: { sessions: { create(p: Record<string, unknown>, o?: Record<string, unknown>): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(p: Record<string, unknown>): Promise<{ url: string }> } };
}

export function createStripeBilling(stripe: StripeBillingLike): BillingProvider {
  return {
    async createSubscriptionCheckout(i) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: i.orgId,
        metadata: { org_id: i.orgId },
        subscription_data: { metadata: { org_id: i.orgId } },
        line_items: [{ price: i.priceId, quantity: 1 }],
        ...(i.customerId ? { customer: i.customerId } : {}),
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
      }, i.idempotencyKey ? { idempotencyKey: i.idempotencyKey } : undefined);
      if (!session.url) throw new Error("checkout session has no url");
      return { url: session.url };
    },
    async createPortalSession(i) {
      const s = await stripe.billingPortal.sessions.create({ customer: i.customerId, return_url: i.returnUrl });
      if (!s.url) throw new Error("portal session has no url");
      return { url: s.url };
    },
  };
}

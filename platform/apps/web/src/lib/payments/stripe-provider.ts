import type { CheckoutInput, PaymentProvider, ProviderEvent } from "./provider";

interface StripeEventLike { id: string; type: string; created?: number; data?: { object?: Record<string, unknown> } }

/** The slice of the Stripe SDK this app uses; lets tests inject a fake and keeps the SDK out of every other file. */
export interface StripeLike {
  checkout: { sessions: { create(p: Record<string, unknown>): Promise<{ id: string; url: string | null }>; expire(id: string): Promise<unknown>; retrieve(id: string): Promise<{ status?: string | null }> } };
  refunds: { create(p: Record<string, unknown>, opts: { idempotencyKey: string }): Promise<{ id: string }> };
  accounts: { create(p: Record<string, unknown>): Promise<{ id: string }> };
  accountLinks: { create(p: Record<string, unknown>): Promise<{ url: string }> };
  webhooks: { constructEvent(body: string, signature: string, secret: string): StripeEventLike };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_EXPIRY_MINUTES = 31; // Stripe rejects sessions that expire in under 30 minutes

/** `webhookSecret` may list several signing secrets: Stripe gives the platform endpoint and the Connect endpoint (account.updated) separate ones. */
export function createStripeProvider(stripe: StripeLike, webhookSecret: string | string[], now: () => number = Date.now): PaymentProvider {
  const secrets = Array.isArray(webhookSecret) ? webhookSecret : [webhookSecret];
  function verify(rawBody: string, signature: string): StripeEventLike {
    let last: unknown = new Error("no webhook secret configured");
    for (const secret of secrets) {
      try {
        return stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  return {
    async createCheckout(i: CheckoutInput) {
      const minutes = Math.min(Math.max(i.expiresInMinutes, MIN_EXPIRY_MINUTES), 24 * 60);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: i.paymentId,
        metadata: { payment_id: i.paymentId },
        line_items: [{ quantity: 1, price_data: { currency: i.currency.toLowerCase(), unit_amount: i.totalMinor, product_data: { name: i.title.slice(0, 120) } } }],
        payment_intent_data: {
          application_fee_amount: i.applicationFeeMinor,
          transfer_data: { destination: i.destinationAccount },
          metadata: { payment_id: i.paymentId },
        },
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        expires_at: Math.floor(now() / 1000) + minutes * 60,
      });
      if (!session.url) throw new Error("checkout session has no url");
      return { sessionId: session.id, url: session.url };
    },

    async expireCheckout(sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId);
        return "expired";
      } catch (e) {
        // Stripe refuses to expire a session that is already paid. That must never be mistaken for "safe to open another".
        const { status } = await stripe.checkout.sessions.retrieve(sessionId);
        if (status === "complete") return "complete";
        if (status === "expired") return "expired";
        throw e;
      }
    },

    async refundPayment(i) {
      if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw new Error("refund amount must be a positive integer");
      if (!i.paymentIntentId) throw new Error("refund needs the payment intent of the charge");
      const refund = await stripe.refunds.create(
        { payment_intent: i.paymentIntentId, amount: i.amountMinor, refund_application_fee: true, reverse_transfer: true, metadata: { payment_id: i.paymentId } },
        { idempotencyKey: i.idempotencyKey },
      );
      return { refundId: refund.id };
    },

    async createOnboardingLink(i) {
      const account = i.account ?? (await stripe.accounts.create({ type: "express" })).id;
      const link = await stripe.accountLinks.create({ account, type: "account_onboarding", return_url: i.returnUrl, refresh_url: i.refreshUrl });
      return { account, url: link.url };
    },

    parseWebhook(rawBody, signature): ProviderEvent {
      const event = verify(rawBody, signature); // throws on a bad signature
      const obj = (event.data?.object ?? {}) as Record<string, unknown> & { id: string; metadata?: Record<string, unknown> };
      const paymentId: unknown = obj.metadata?.payment_id;
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          if (obj.payment_status === "paid" && typeof paymentId === "string" && typeof obj.payment_intent === "string") {
            return {
              kind: "payment_succeeded", id: event.id, paymentId, sessionId: obj.id, intentId: obj.payment_intent,
              amountTotal: Number(obj.amount_total), currency: String(obj.currency).toUpperCase(),
            };
          }
          return { kind: "ignored", id: event.id, type: event.type };
        case "refund.created":
        case "refund.updated":
          // A refund is final only once Stripe says it succeeded; metadata.payment_id is what refundPayment attached.
          if (obj.status === "succeeded" && typeof paymentId === "string") {
            return { kind: "refund_succeeded", id: event.id, paymentId, refundId: obj.id, amount: Number(obj.amount), currency: String(obj.currency).toUpperCase() };
          }
          return { kind: "ignored", id: event.id, type: event.type };
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed":
          if (typeof paymentId === "string") return { kind: "payment_failed", id: event.id, paymentId, sessionId: obj.id };
          return { kind: "ignored", id: event.id, type: event.type };
        case "account.updated":
          return { kind: "account_updated", id: event.id, accountId: obj.id, payoutsEnabled: obj.payouts_enabled === true, detailsSubmitted: obj.details_submitted === true };
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const orgId = obj.metadata?.org_id;
          const item = (obj.items as { data?: { price?: { id?: string }; current_period_end?: number }[] } | undefined)?.data?.[0];
          const customer = obj.customer;
          const customerId = typeof customer === "string" ? customer : (customer as { id?: unknown } | null)?.id;
          const priceId = item?.price?.id;
          if (typeof orgId !== "string" || !UUID.test(orgId) || typeof customerId !== "string" || typeof priceId !== "string" || typeof obj.status !== "string") {
            return { kind: "ignored", id: event.id, type: event.type };
          }
          const end = typeof item?.current_period_end === "number" ? item.current_period_end : typeof obj.current_period_end === "number" ? obj.current_period_end : null;
          return {
            kind: "subscription_changed", id: event.id, orgId, customerId, subscriptionId: obj.id, priceId,
            status: event.type === "customer.subscription.deleted" ? "canceled" : obj.status,
            periodEnd: end === null ? null : new Date(end * 1000).toISOString(),
            cancelAtPeriodEnd: obj.cancel_at_period_end === true,
            eventAt: new Date((event.created ?? Math.floor(now() / 1000)) * 1000).toISOString(),
          };
        }
        default:
          return { kind: "ignored", id: event.id, type: event.type };
      }
    },
  };
}

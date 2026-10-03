import { processOnce, type WebhookStore } from "../webhooks";
import type { PaymentProvider } from "./provider";
import type { PaymentsServiceDb } from "./service-db";

interface Deps {
  provider: Pick<PaymentProvider, "parseWebhook">;
  store: WebhookStore;
  db: Pick<PaymentsServiceDb, "recordPaymentSucceeded" | "recordPaymentFailed" | "recordAccountUpdate" | "recordRefundSucceeded" | "recordSubscription">;
  /** Called for outcomes a human must look at (never carries the signature or raw body). */
  alert: (message: string, context: Record<string, unknown>) => void;
}

const NEEDS_ATTENTION = new Set(["mismatch", "duplicate_charge", "unknown", "paid_on_cancelled", "unknown_org", "unknown_plan", "conflict"]);

/**
 * Stripe webhook core. Order: verify signature -> normalize -> claim event id -> apply -> mark processed.
 * Only a verified event changes payment state. A failure releases the claim and returns 500 so Stripe retries.
 */
export function createWebhookHandler(deps: Deps) {
  return async function handle(rawBody: string, signature: string | null): Promise<{ status: number }> {
    if (!signature) return { status: 400 };
    let event;
    try {
      event = deps.provider.parseWebhook(rawBody, signature);
    } catch {
      return { status: 400 };
    }
    if (event.kind === "ignored") return { status: 200 };
    try {
      await processOnce(deps.store, "stripe", event.id, async () => {
        if (event.kind === "payment_succeeded") {
          const result = await deps.db.recordPaymentSucceeded({
            paymentId: event.paymentId, sessionId: event.sessionId, intentId: event.intentId, amountTotal: event.amountTotal, currency: event.currency,
          });
          if (NEEDS_ATTENTION.has(result)) deps.alert(`payment webhook outcome: ${result}`, { eventId: event.id, paymentId: event.paymentId });
        } else if (event.kind === "payment_failed") {
          await deps.db.recordPaymentFailed(event.paymentId, event.sessionId);
        } else if (event.kind === "refund_succeeded") {
          const result = await deps.db.recordRefundSucceeded({ paymentId: event.paymentId, refundId: event.refundId, amount: event.amount, currency: event.currency });
          if (NEEDS_ATTENTION.has(result)) deps.alert(`payment webhook outcome: ${result}`, { eventId: event.id, paymentId: event.paymentId });
        } else if (event.kind === "subscription_changed") {
          const result = await deps.db.recordSubscription({
            orgId: event.orgId, customerId: event.customerId, subscriptionId: event.subscriptionId, priceId: event.priceId,
            status: event.status, periodEnd: event.periodEnd, cancelAtPeriodEnd: event.cancelAtPeriodEnd, eventAt: event.eventAt,
          });
          if (NEEDS_ATTENTION.has(result)) deps.alert(`subscription webhook outcome: ${result}`, { eventId: event.id, orgId: event.orgId });
        } else {
          await deps.db.recordAccountUpdate(event.accountId, event.payoutsEnabled, event.detailsSubmitted);
        }
      }, { type: event.kind });
    } catch {
      return { status: 500 };
    }
    return { status: 200 };
  };
}

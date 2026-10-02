import type { PaymentProvider } from "./provider";
import type { PaymentsServiceDb } from "./service-db";

interface Deps {
  db: Pick<PaymentsServiceDb, "listPendingRefunds" | "recordRefundFailed">;
  provider: Pick<PaymentProvider, "refundPayment">;
}

/**
 * Sends the refunds a ruling queued. The database decides what is pending and how much; this only calls Stripe.
 * "Issued" means Stripe accepted the call: the verified webhook finalizes. Safe to call again (Retry) because every
 * refund carries a deterministic idempotency key, so Stripe returns the same refund instead of creating a second one.
 */
export function createRefundService(deps: Deps) {
  return {
    async issueForDispute(disputeId: string): Promise<{ issued: number; failed: number }> {
      let issued = 0;
      let failed = 0;
      for (const r of await deps.db.listPendingRefunds(disputeId)) {
        try {
          await deps.provider.refundPayment({ paymentId: r.paymentId, paymentIntentId: r.paymentIntentId, amountMinor: r.amount, currency: r.currency, idempotencyKey: r.idempotencyKey });
          issued++;
        } catch (e) {
          failed++;
          try {
            await deps.db.recordRefundFailed(r.paymentId, e instanceof Error ? e.message : "refund failed");
          } catch {
            // best effort: the refund stays pending and the admin can retry
          }
        }
      }
      return { issued, failed };
    },
  };
}
export type RefundService = ReturnType<typeof createRefundService>;

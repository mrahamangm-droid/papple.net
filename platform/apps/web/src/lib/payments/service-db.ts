export type ServiceRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Service-role-only RPCs. Never expose these to a user-facing client. */
export function createPaymentsServiceDb(rpc: ServiceRpc) {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  return {
    paymentDestination: (paymentId: string) => call<string>("payment_destination", { p_payment: paymentId }),
    /** Compare-and-set against the session the caller saw at approval. False means another click attached first. */
    attachCheckoutSession: (paymentId: string, sessionId: string, previous: string | null) =>
      call<boolean>("attach_checkout_session", { p_payment: paymentId, p_session: sessionId, p_prev: previous }),
    recordPaymentSucceeded: (i: { paymentId: string; sessionId: string; intentId: string; amountTotal: number; currency: string }) =>
      call<string>("record_payment_succeeded", { p_payment: i.paymentId, p_session: i.sessionId, p_intent: i.intentId, p_amount: i.amountTotal, p_currency: i.currency }),
    recordPaymentFailed: (paymentId: string, sessionId: string) => call<string>("record_payment_failed", { p_payment: paymentId, p_session: sessionId }),
    payoutAccount: (orgId: string) => call<string | null>("payout_account", { p_org: orgId }),
    registerConnectedAccount: (orgId: string, account: string) => call<void>("register_connected_account", { p_org: orgId, p_account: account }),
    listPendingRefunds: async (disputeId: string) => {
      const rows = await call<{ payment_id: string; payment_intent_id: string; amount: number; currency: string; idempotency_key: string }[]>("list_pending_refunds", { p_dispute: disputeId });
      return rows.map((r) => ({ paymentId: r.payment_id, paymentIntentId: r.payment_intent_id, amount: r.amount, currency: r.currency, idempotencyKey: r.idempotency_key }));
    },
    recordRefundSucceeded: (i: { paymentId: string; refundId: string; amount: number; currency: string }) =>
      call<string>("record_refund_succeeded", { p_payment: i.paymentId, p_refund: i.refundId, p_amount: i.amount, p_currency: i.currency }),
    recordRefundFailed: (paymentId: string, reason: string) => call<void>("record_refund_failed", { p_payment: paymentId, p_reason: reason }),
    recordSubscription: (i: { orgId: string; customerId: string; subscriptionId: string; priceId: string; status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean; eventAt: string }) =>
      call<string>("apply_subscription_event", { p_org: i.orgId, p_customer: i.customerId, p_sub: i.subscriptionId, p_price: i.priceId, p_status: i.status, p_period_end: i.periodEnd, p_cancel: i.cancelAtPeriodEnd, p_event_at: i.eventAt }),
    billingCustomer: (orgId: string) => call<string | null>("org_billing_customer", { p_org: orgId }),
    recordAccountUpdate: (account: string, payoutsEnabled: boolean, detailsSubmitted: boolean) =>
      call<boolean>("record_account_update", { p_account: account, p_payouts: payoutsEnabled, p_details: detailsSubmitted }),
  };
}
export type PaymentsServiceDb = ReturnType<typeof createPaymentsServiceDb>;

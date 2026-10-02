/** Provider-neutral payment boundary. Only this file's types leak into the rest of the app. */
export interface CheckoutInput {
  paymentId: string;
  totalMinor: number; // what the client pays
  applicationFeeMinor: number; // what Papple keeps; the rest goes to the destination account
  currency: string; // ISO 4217, upper case
  destinationAccount: string;
  title: string;
  successUrl: string;
  cancelUrl: string;
  expiresInMinutes: number;
}

export type ProviderEvent =
  | { kind: "payment_succeeded"; id: string; paymentId: string; sessionId: string; intentId: string; amountTotal: number; currency: string }
  | { kind: "payment_failed"; id: string; paymentId: string; sessionId: string }
  | { kind: "refund_succeeded"; id: string; paymentId: string; refundId: string; amount: number; currency: string }
  | { kind: "account_updated"; id: string; accountId: string; payoutsEnabled: boolean; detailsSubmitted: boolean }
  | { kind: "ignored"; id: string; type: string };

export interface PaymentProvider {
  createCheckout(i: CheckoutInput): Promise<{ sessionId: string; url: string }>;
  /** Expires an open session. Returns "complete" when the client already paid it (it cannot be expired), so callers never open a second one. */
  expireCheckout(sessionId: string): Promise<"expired" | "complete">;
  /** Refunds the whole charge, returns Papple's application fee and reverses the transfer. The idempotency key makes a retry safe. */
  refundPayment(i: { paymentId: string; paymentIntentId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<{ refundId: string }>;
  createOnboardingLink(i: { account?: string; returnUrl: string; refreshUrl: string }): Promise<{ account: string; url: string }>;
  /** Verifies the signature and normalizes the event. Throws on a missing or invalid signature. */
  parseWebhook(rawBody: string, signature: string): ProviderEvent;
}

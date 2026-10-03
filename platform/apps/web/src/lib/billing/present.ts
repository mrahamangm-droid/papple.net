import type { BillingResult } from "./service";

const MESSAGES: Record<Extract<BillingResult, { ok: false }>["code"], string> = {
  forbidden: "Only the owner of the organization can manage billing.",
  invalid: "That plan is not available right now.",
  rate: "Too many attempts. Please wait a minute and try again.",
  unavailable: "Billing is not available yet. Please try again later.",
  error: "Something went wrong with billing. Nothing was charged. Please try again.",
};

export const billingMessage = (code: Extract<BillingResult, { ok: false }>["code"]): string => MESSAGES[code];

export interface SubscriptionView { status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean; pastDueSince: string | null }

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One plain sentence about where an organization's paid plan stands. `graceDays` mirrors the database setting. */
export function describeSubscription(s: SubscriptionView | null, now: Date, graceDays: number): string {
  if (!s || s.status === "canceled" || s.status === "incomplete_expired") {
    return s ? "The subscription was cancelled. The organization is on the Free plan." : "The organization is on the Free plan.";
  }
  if (s.status === "past_due" && s.pastDueSince) {
    const left = Math.ceil((new Date(s.pastDueSince).getTime() + graceDays * 86_400_000 - now.getTime()) / 86_400_000);
    return left > 0
      ? `The last payment failed. Paid features stay on for ${left} more day${left === 1 ? "" : "s"}; update the payment method to keep them.`
      : "The last payment failed and the grace period has ended, so the organization is on the Free plan until the payment method is updated.";
  }
  if (s.status === "active" || s.status === "trialing") {
    if (!s.periodEnd) return "The subscription is active.";
    return s.cancelAtPeriodEnd ? `The subscription ends on ${date(s.periodEnd)} and will not renew.` : `The subscription renews on ${date(s.periodEnd)}.`;
  }
  return "The subscription needs attention. Open billing to review the payment method.";
}

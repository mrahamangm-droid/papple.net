import { z } from "zod";
import type { BillingProvider } from "../payments/billing-provider";

export type BillingResult = { ok: true; url: string } | { ok: false; code: "forbidden" | "invalid" | "rate" | "unavailable" | "error" };

export interface BillingDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Asked of the database as the caller: only an owner of the organization passes. */
  canManageBilling: (orgId: string) => Promise<boolean>;
  loadPlan: (key: string) => Promise<{ key: string; active: boolean; stripePriceId: string | null } | null>;
  loadSubscription: (orgId: string) => Promise<{ status: string; customerId: string | null } | null>;
  /** The platform's free-trial length (setting billing.trial_days); 0 turns trials off. */
  trialDays: () => Promise<number>;
  /** Null when Stripe Billing is not configured. */
  billing: BillingProvider | null;
  siteUrl: string;
  now?: () => number;
}

const checkoutInput = z.object({ orgId: z.string().uuid(), planKey: z.string().trim().min(1).max(60) });
const portalInput = z.object({ orgId: z.string().uuid() });
/** A subscription in any of these states still exists at Stripe: a second one must never be created beside it. */
const LIVE = new Set(["incomplete", "trialing", "active", "past_due", "unpaid", "paused"]);

const IDEMPOTENCY_WINDOW_MS = 30 * 60_000;

/** Only ever hand the browser a Stripe-hosted https address. */
function safeStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

export function createBillingService(deps: BillingDeps) {
  const back = (suffix = "") => `${deps.siteUrl}/settings/billing${suffix}`;

  /** Shared gate: signed in, throttled, owner. Input is validated by the caller first. */
  async function gate(orgId: string): Promise<{ ok: false; code: "forbidden" | "rate" | "unavailable" | "error" } | { ok: true; billing: BillingProvider }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
    try {
      if (!(await deps.canManageBilling(orgId))) return { ok: false, code: "forbidden" };
    } catch {
      return { ok: false, code: "error" };
    }
    if (!deps.billing) return { ok: false, code: "unavailable" };
    return { ok: true, billing: deps.billing };
  }

  async function portal(billing: BillingProvider, customerId: string): Promise<BillingResult> {
    const { url } = await billing.createPortalSession({ customerId, returnUrl: back() });
    return safeStripeUrl(url) ? { ok: true, url } : { ok: false, code: "error" };
  }

  return {
    async startCheckout(raw: unknown): Promise<BillingResult> {
      const parsed = checkoutInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const { orgId, planKey } = parsed.data;
      const g = await gate(orgId);
      if (!g.ok) return g;
      try {
        const plan = await deps.loadPlan(planKey);
        if (!plan || !plan.active || !plan.stripePriceId) return { ok: false, code: "invalid" };
        const sub = await deps.loadSubscription(orgId);
        if (sub?.customerId && LIVE.has(sub.status)) return await portal(g.billing, sub.customerId);
        // one free trial per organization: any earlier subscription, even a cancelled one, means it was used
        const trialDays = sub ? 0 : await deps.trialDays();
        const { url } = await g.billing.createSubscriptionCheckout({
          orgId, priceId: plan.stripePriceId, customerId: sub?.customerId ?? null, trialDays,
          // Stripe returns the same session for the same key: a double click or a second tab cannot open two subscriptions.
          idempotencyKey: `checkout:${orgId}:${plan.key}:${Math.floor((deps.now?.() ?? Date.now()) / IDEMPOTENCY_WINDOW_MS)}`,
          successUrl: back("?checkout=success"), cancelUrl: back("?checkout=cancelled"),
        });
        return safeStripeUrl(url) ? { ok: true, url } : { ok: false, code: "error" };
      } catch {
        return { ok: false, code: "error" };
      }
    },

    async openPortal(raw: unknown): Promise<BillingResult> {
      const parsed = portalInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const g = await gate(parsed.data.orgId);
      if (!g.ok) return g;
      try {
        const sub = await deps.loadSubscription(parsed.data.orgId);
        if (!sub?.customerId) return { ok: false, code: "invalid" };
        return await portal(g.billing, sub.customerId);
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}

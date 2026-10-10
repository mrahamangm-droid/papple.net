import { z } from "zod";
import type { CheckoutInput, PaymentProvider } from "../payments/provider";
import type { BookingFailure } from "./present";

type Fail = { ok: false; code: BookingFailure };
export interface QueuedRefund { paymentId: string; paymentIntentId: string; amount: number; currency: string; idempotencyKey: string }

export interface BookingPaymentsDeps {
  getUserId: () => Promise<string | null>;
  /** The existing `checkout` rate rule. */
  throttle: (userId: string) => Promise<boolean>;
  /** As the signed-in user: the database decides who may pay and what is owed. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  /** Service-role calls. Only ever reached after a user-scoped call above has allowed the action. */
  service: {
    destination: (paymentId: string) => Promise<string>;
    attach: (paymentId: string, sessionId: string, previous: string | null) => Promise<boolean>;
    refundToSend: (bookingId: string) => Promise<QueuedRefund | null>;
    recordRefundFailed: (paymentId: string, reason: string) => Promise<void>;
  };
  provider: Pick<PaymentProvider, "createCheckout" | "expireCheckout" | "refundPayment">;
  appUrl: () => string;
  expiryMinutes: () => Promise<number>;
  revalidate: (path: string) => void;
  now?: () => Date;
}

const id = z.string().uuid();
const ref = z.object({ orgId: id, bookingId: id });
const minor = z.number().int().nonnegative();
const quote = z.object({
  payment_id: id, client_total: minor.positive(), application_fee: minor, currency: z.string().regex(/^[A-Z]{3}$/),
  title: z.string(), previous_session: z.string().nullable(), pay_by: z.string(),
});

const failure = (code?: string): BookingFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "55000" ? "stale" : "error";

/** Stripe sessions live 30 minutes to 24 hours. Keep the session inside the payment window when the window allows it;
 *  a payment that still lands after the window is refunded in full by the database (paid after release). */
export function checkoutMinutes(configured: number, payBy: string, now: Date): number {
  const left = Math.floor((Date.parse(payBy) - now.getTime()) / 60_000);
  return Math.max(30, Number.isFinite(left) ? Math.min(configured, left) : 30);
}

class Duplicate extends Error {}

/** Paying a confirmed booking and sending refunds the database queued. The sequence mirrors contracts' approveAndPay. */
export function createBookingPayments(deps: BookingPaymentsDeps) {
  const site = () => deps.appUrl().replace(/\/$/, "");
  const now = () => (deps.now ? deps.now() : new Date());

  async function gate(raw: unknown): Promise<{ ok: true; v: z.infer<typeof ref> } | Fail> {
    const p = ref.safeParse(raw);
    if (!p.success) return { ok: false, code: "invalid" };
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    return { ok: true, v: p.data };
  }

  async function sendRefund(bookingId: string): Promise<{ ok: boolean }> {
    let r: QueuedRefund | null = null;
    try {
      r = await deps.service.refundToSend(bookingId);
      if (!r) return { ok: true };
      await deps.provider.refundPayment({ paymentId: r.paymentId, paymentIntentId: r.paymentIntentId, amountMinor: r.amount, currency: r.currency, idempotencyKey: r.idempotencyKey });
      return { ok: true };
    } catch (e) {
      if (r) {
        try {
          await deps.service.recordRefundFailed(r.paymentId, e instanceof Error ? e.message : "refund failed");
        } catch {
          // best effort: the refund stays pending and can be retried
        }
      }
      return { ok: false };
    }
  }

  return {
    async pay(raw: unknown): Promise<{ ok: true; url: string } | Fail> {
      const g = await gate(raw);
      if (!g.ok) return g;
      const { orgId, bookingId } = g.v;
      try {
        const { data, error } = await deps.rpc("booking_pay", { p_org: orgId, p_booking: bookingId });
        if (error) return { ok: false, code: failure(error.code) };
        const q = quote.safeParse(data);
        if (!q.success) return { ok: false, code: "error" };
        const a = q.data;
        // A stale open session must not stay payable, and one the client already paid must never get a second charge.
        if (a.previous_session && (await deps.provider.expireCheckout(a.previous_session)) === "complete") throw new Duplicate();
        const input: CheckoutInput = {
          paymentId: a.payment_id, totalMinor: a.client_total, applicationFeeMinor: a.application_fee, currency: a.currency,
          destinationAccount: await deps.service.destination(a.payment_id), title: a.title,
          successUrl: `${site()}/bookings?org=${orgId}&paid=1`, cancelUrl: `${site()}/bookings?org=${orgId}`,
          expiresInMinutes: checkoutMinutes(await deps.expiryMinutes(), a.pay_by, now()),
        };
        const session = await deps.provider.createCheckout(input);
        if (!(await deps.service.attach(a.payment_id, session.sessionId, a.previous_session))) {
          // A parallel click won: only one live session may exist.
          await deps.provider.expireCheckout(session.sessionId).catch(() => undefined);
          throw new Duplicate();
        }
        deps.revalidate("/bookings");
        return { ok: true, url: session.url };
      } catch (e) {
        return { ok: false, code: e instanceof Duplicate ? "duplicate" : "error" };
      }
    },

    sendRefund,

    /** The "Retry refund" button: the database confirms the caller belongs to the booking before anything is sent. */
    async retryRefund(raw: unknown): Promise<{ ok: true } | Fail> {
      const g = await gate(raw);
      if (!g.ok) return g;
      try {
        const { data, error } = await deps.rpc("booking_refund_pending", { p_org: g.v.orgId, p_booking: g.v.bookingId });
        if (error) return { ok: false, code: failure(error.code) };
        if (data !== true) return { ok: true };
      } catch {
        return { ok: false, code: "error" };
      }
      const sent = await sendRefund(g.v.bookingId);
      deps.revalidate("/bookings");
      return sent.ok ? { ok: true } : { ok: false, code: "refund_failed" };
    },
  };
}
export type BookingPayments = ReturnType<typeof createBookingPayments>;

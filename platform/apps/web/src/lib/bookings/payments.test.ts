import { describe, expect, it, vi } from "vitest";
import { createBookingPayments, checkoutMinutes, type BookingPaymentsDeps } from "./payments";

const ORG = "11111111-1111-4111-8111-111111111111";
const BK = "33333333-3333-4333-8333-333333333333";
const PAY = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2027-03-01T10:00:00Z");
const quote = (over: Record<string, unknown> = {}) => ({
  payment_id: PAY, amount: 10000, client_fee: 200, provider_fee: 500, client_total: 10200, application_fee: 700, currency: "USD",
  title: "Consultation", previous_session: null, pay_by: "2027-03-02T10:00:00Z", ...over,
});

function mk(over: Partial<BookingPaymentsDeps> = {}, payData: unknown = quote()) {
  const rpc = vi.fn(async (fn: string) => (fn === "booking_pay" ? { data: payData, error: null } : fn === "booking_refund_pending" ? { data: true, error: null } : { data: null, error: null }));
  const deps: BookingPaymentsDeps = {
    getUserId: async () => "u1",
    throttle: async () => true,
    rpc: rpc as never,
    service: {
      destination: vi.fn(async () => "acct_1"),
      attach: vi.fn(async () => true),
      refundToSend: vi.fn(async () => ({ paymentId: PAY, paymentIntentId: "pi_1", amount: 10200, currency: "USD", idempotencyKey: `booking-refund-${PAY}` })),
      recordRefundFailed: vi.fn(async () => undefined),
    },
    provider: {
      createCheckout: vi.fn(async () => ({ sessionId: "cs_new", url: "https://checkout.test/cs_new" })),
      expireCheckout: vi.fn(async () => "expired" as const),
      refundPayment: vi.fn(async () => ({ refundId: "re_1" })),
    },
    appUrl: () => "https://papple.test/",
    expiryMinutes: async () => 60,
    revalidate: vi.fn(),
    now: () => NOW,
    ...over,
  };
  return { pay: createBookingPayments(deps), deps, rpc };
}

describe("checkoutMinutes", () => {
  it("never outlives the payment window, but respects Stripe's 30 minute floor", () => {
    expect(checkoutMinutes(60, "2027-03-02T10:00:00Z", NOW)).toBe(60);
    expect(checkoutMinutes(60, "2027-03-01T10:45:30Z", NOW)).toBe(45);
    expect(checkoutMinutes(60, "2027-03-01T10:10:00Z", NOW)).toBe(30);
    expect(checkoutMinutes(60, "not a date", NOW)).toBe(30);
  });
});

describe("pay", () => {
  it("refuses bad input, signed-out users and the rate limit before any call", async () => {
    const a = mk();
    expect(await a.pay.pay({ orgId: ORG, bookingId: "x" })).toEqual({ ok: false, code: "invalid" });
    expect(await mk({ getUserId: async () => null }).pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "forbidden" });
    expect(await mk({ throttle: async () => false }).pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "rate" });
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it("opens one checkout for exactly what the database says is owed", async () => {
    const { pay, deps, rpc } = mk();
    expect(await pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: true, url: "https://checkout.test/cs_new" });
    expect(rpc).toHaveBeenCalledWith("booking_pay", { p_org: ORG, p_booking: BK });
    expect(deps.provider.expireCheckout).not.toHaveBeenCalled();
    expect(deps.provider.createCheckout).toHaveBeenCalledWith({
      paymentId: PAY, totalMinor: 10200, applicationFeeMinor: 700, currency: "USD", destinationAccount: "acct_1", title: "Consultation",
      successUrl: `https://papple.test/bookings?org=${ORG}&paid=1`, cancelUrl: `https://papple.test/bookings?org=${ORG}`, expiresInMinutes: 60,
    });
    expect(deps.service.attach).toHaveBeenCalledWith(PAY, "cs_new", null);
    expect(deps.revalidate).toHaveBeenCalledWith("/bookings");
  });

  it("expires the previous open session first", async () => {
    const { pay, deps } = mk({}, quote({ previous_session: "cs_old" }));
    expect((await pay.pay({ orgId: ORG, bookingId: BK })).ok).toBe(true);
    expect(deps.provider.expireCheckout).toHaveBeenCalledWith("cs_old");
    expect(deps.service.attach).toHaveBeenCalledWith(PAY, "cs_new", "cs_old");
  });

  it("never opens a second checkout when the previous one was already paid", async () => {
    const { pay, deps } = mk({}, quote({ previous_session: "cs_old" }));
    (deps.provider.expireCheckout as ReturnType<typeof vi.fn>).mockResolvedValueOnce("complete");
    expect(await pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "duplicate" });
    expect(deps.provider.createCheckout).not.toHaveBeenCalled();
  });

  it("expires its own session and reports a duplicate when a parallel click won", async () => {
    const { pay, deps } = mk({ service: { ...mk().deps.service, attach: vi.fn(async () => false) } });
    expect(await pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "duplicate" });
    expect(deps.provider.expireCheckout).toHaveBeenCalledWith("cs_new");
  });

  it("maps database refusals and rejects a malformed answer", async () => {
    const refused = mk({ rpc: vi.fn(async () => ({ data: null, error: { code: "55000" } })) as never });
    expect(await refused.pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "stale" });
    expect(refused.deps.provider.createCheckout).not.toHaveBeenCalled();
    expect(await mk({}, quote({ client_total: "10200" })).pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "error" });
  });

  it("turns a provider failure into a generic error", async () => {
    const { pay } = mk({ provider: { ...mk().deps.provider, createCheckout: vi.fn(async () => { throw new Error("stripe down"); }) } });
    expect(await pay.pay({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "error" });
  });
});

describe("sendRefund", () => {
  it("sends the queued refund with its fixed idempotency key", async () => {
    const { pay, deps } = mk();
    expect(await pay.sendRefund(BK)).toEqual({ ok: true });
    expect(deps.provider.refundPayment).toHaveBeenCalledWith({ paymentId: PAY, paymentIntentId: "pi_1", amountMinor: 10200, currency: "USD", idempotencyKey: `booking-refund-${PAY}` });
  });

  it("does nothing when no refund is queued", async () => {
    const { pay, deps } = mk({ service: { ...mk().deps.service, refundToSend: vi.fn(async () => null) } });
    expect(await pay.sendRefund(BK)).toEqual({ ok: true });
    expect(deps.provider.refundPayment).not.toHaveBeenCalled();
  });

  it("records a provider failure so it can be retried", async () => {
    const { pay, deps } = mk({ provider: { ...mk().deps.provider, refundPayment: vi.fn(async () => { throw new Error("card_declined"); }) } });
    expect(await pay.sendRefund(BK)).toEqual({ ok: false });
    expect(deps.service.recordRefundFailed).toHaveBeenCalledWith(PAY, "card_declined");
  });
});

describe("retryRefund", () => {
  it("asks the database whether this member may resend, then sends", async () => {
    const { pay, deps, rpc } = mk();
    expect(await pay.retryRefund({ orgId: ORG, bookingId: BK })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("booking_refund_pending", { p_org: ORG, p_booking: BK });
    expect(deps.provider.refundPayment).toHaveBeenCalled();
  });

  it("refuses outsiders and does nothing when nothing is pending", async () => {
    const outsider = mk({ rpc: vi.fn(async () => ({ data: null, error: { code: "42501" } })) as never });
    expect(await outsider.pay.retryRefund({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "forbidden" });
    expect(outsider.deps.provider.refundPayment).not.toHaveBeenCalled();
    const none = mk({ rpc: vi.fn(async () => ({ data: false, error: null })) as never });
    expect(await none.pay.retryRefund({ orgId: ORG, bookingId: BK })).toEqual({ ok: true });
    expect(none.deps.provider.refundPayment).not.toHaveBeenCalled();
  });

  it("reports a failed resend", async () => {
    const { pay } = mk({ provider: { ...mk().deps.provider, refundPayment: vi.fn(async () => { throw new Error("x"); }) } });
    expect(await pay.retryRefund({ orgId: ORG, bookingId: BK })).toEqual({ ok: false, code: "refund_failed" });
  });
});

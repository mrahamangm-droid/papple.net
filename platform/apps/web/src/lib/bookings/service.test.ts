import { describe, expect, it, vi } from "vitest";
import { createBookingsService, type BookingsDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const SVC = "22222222-2222-4222-8222-222222222222";
const BK = "33333333-3333-4333-8333-333333333333";
type RpcImpl = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
function mk(rpcImpl?: RpcImpl, over: Partial<BookingsDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: null, error: null })));
  const revalidate = vi.fn();
  const deps: BookingsDeps = { getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, ...over };
  return { svc: createBookingsService(deps), rpc, revalidate };
}
const settings = { orgId: ORG, enabled: true, timezone: "Europe/London", bufferMinutes: 10, noticeHours: 12, horizonDays: 30, hours: [{ weekday: 1, start: "09:00", end: "17:00" }] };

describe("gates", () => {
  it("needs a signed-in user and respects the rate limit", async () => {
    expect(await mk(undefined, { getUserId: async () => null }).svc.cancel({ orgId: ORG, bookingId: BK, reason: "x" })).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(undefined, { throttle: async () => false }).svc.cancel({ orgId: ORG, bookingId: BK, reason: "x" })).toEqual({ ok: false, code: "rate" });
  });
});

describe("validation before any call", () => {
  it.each([
    ["minutes 20", (s: ReturnType<typeof mk>["svc"]) => s.setServiceBooking({ orgId: ORG, serviceId: SVC, minutes: 20 })],
    ["http meeting link", (s: ReturnType<typeof mk>["svc"]) => s.decide({ orgId: ORG, bookingId: BK, confirm: true, meetingUrl: "http://x.test", reason: "" })],
    ["32 day span", (s: ReturnType<typeof mk>["svc"]) => s.slots({ serviceId: SVC, from: "2027-01-01T00:00:00Z", to: "2027-02-02T00:00:00Z" })],
    ["hour 24", (s: ReturnType<typeof mk>["svc"]) => s.saveSettings({ ...settings, hours: [{ weekday: 1, start: "24:00", end: "25:00" }] })],
    ["blank cancel reason", (s: ReturnType<typeof mk>["svc"]) => s.cancel({ orgId: ORG, bookingId: BK, reason: "  " })],
    ["bad start", (s: ReturnType<typeof mk>["svc"]) => s.request({ orgId: ORG, serviceId: SVC, start: "tomorrow", note: "" })],
  ])("refuses %s", async (_name, call) => {
    const { svc, rpc } = mk();
    expect(await call(svc)).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("calls", () => {
  it("sends settings with snake_case hours", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.saveSettings(settings)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("booking_settings_save", { p_org: ORG, p_enabled: true, p_timezone: "Europe/London", p_buffer: 10, p_notice: 12, p_horizon: 30, p_hours: [{ weekday: 1, start: "09:00", end: "17:00" }] });
    expect(revalidate).toHaveBeenCalledWith("/settings/bookings");
  });
  it("returns slots as ISO strings and treats anything else as an error", async () => {
    expect(await mk(async () => ({ data: ["2027-01-04T09:30:00+00:00"], error: null })).svc.slots({ serviceId: SVC, from: "2027-01-04T00:00:00Z", to: "2027-01-05T00:00:00Z" }))
      .toEqual({ ok: true, slots: ["2027-01-04T09:30:00.000Z"] });
    expect(await mk(async () => ({ data: [42], error: null })).svc.slots({ serviceId: SVC, from: "2027-01-04T00:00:00Z", to: "2027-01-05T00:00:00Z" }))
      .toEqual({ ok: false, code: "error" });
  });
  it("returns the new booking id and refreshes the list", async () => {
    const { svc, rpc, revalidate } = mk(async () => ({ data: BK, error: null }));
    expect(await svc.request({ orgId: ORG, serviceId: SVC, start: "2027-01-04T09:30:00Z", note: " hi " })).toEqual({ ok: true, id: BK });
    expect(rpc).toHaveBeenCalledWith("booking_request", { p_org: ORG, p_service: SVC, p_start: "2027-01-04T09:30:00.000Z", p_note: "hi" });
    expect(revalidate).toHaveBeenCalledWith("/bookings");
  });
  it.each([["42501", "forbidden"], ["22023", "invalid"], ["23505", "taken"], ["54000", "limit"], ["55000", "stale"], ["XX000", "error"]])(
    "maps %s to %s", async (code, out) => {
      expect(await mk(async () => ({ data: null, error: { code } })).svc.cancel({ orgId: ORG, bookingId: BK, reason: "x" })).toEqual({ ok: false, code: out });
    });
});

describe("paid bookings", () => {
  it("reports whether a cancellation queued a refund", async () => {
    expect(await mk(async () => ({ data: "refund_pending", error: null })).svc.cancel({ orgId: ORG, bookingId: BK, reason: "x" })).toEqual({ ok: true, refund: true });
    expect(await mk(async () => ({ data: "cancelled", error: null })).svc.cancel({ orgId: ORG, bookingId: BK, reason: "x" })).toEqual({ ok: true, refund: false });
  });
  it("turns the typed price into minor units, empty meaning free", async () => {
    const { svc, rpc } = mk();
    expect(await svc.setServicePrice({ orgId: ORG, serviceId: SVC, price: "50.5", currency: "USD" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("service_set_booking_price", { p_org: ORG, p_service: SVC, p_price: 5050 });
    expect(await svc.setServicePrice({ orgId: ORG, serviceId: SVC, price: " ", currency: "USD" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("service_set_booking_price", { p_org: ORG, p_service: SVC, p_price: null });
    expect(await svc.setServicePrice({ orgId: ORG, serviceId: SVC, price: "5000", currency: "JPY" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("service_set_booking_price", { p_org: ORG, p_service: SVC, p_price: 5000 });
  });
  it.each(["50.555", "0", "-5", "1e3", "abc", "100000.01", "5,00"])("refuses the price %s without rounding it", async (price) => {
    const { svc, rpc } = mk();
    expect(await svc.setServicePrice({ orgId: ORG, serviceId: SVC, price, currency: "USD" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

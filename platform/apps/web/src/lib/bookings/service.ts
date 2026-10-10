import { z } from "zod";
import { minorExponent, toMinor } from "../marketplace/present";
import type { BookingFailure } from "./present";

export type { BookingFailure };
type Fail = { ok: false; code: BookingFailure };
export type DoneResult = { ok: true } | Fail;
export type CancelResult = { ok: true; refund: boolean; bookingId: string } | Fail;

export interface BookingsDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const id = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const instant = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))).transform((s) => new Date(s).toISOString());
const settingsInput = z.object({
  orgId: id, enabled: z.boolean(), timezone: z.string().min(1).max(64),
  bufferMinutes: z.number().int().min(0).max(120), noticeHours: z.number().int().min(0).max(720), horizonDays: z.number().int().min(1).max(90),
  hours: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm }).refine((h) => h.start < h.end)).max(21),
});
const serviceInput = z.object({ orgId: id, serviceId: id, minutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.null()]) });
const slotsInput = z.object({ serviceId: id, from: instant, to: instant })
  .refine((v) => v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400_000);
const requestInput = z.object({ orgId: id, serviceId: id, start: instant, note: z.string().max(1000) });
const decideInput = z.object({
  orgId: id, bookingId: id, confirm: z.boolean(),
  meetingUrl: z.string().trim().max(500).refine((s) => s === "" || /^https:\/\/[^\s]+$/.test(s)), reason: z.string().max(500),
});
const priceInput = z.object({ orgId: id, serviceId: id, price: z.string().max(20), currency: z.string().regex(/^[A-Z]{3}$/) });
const MAX_PRICE = 10_000_000;
/** Major-unit text -> minor units; "" is free (null). undefined when invalid: never rounds away extra decimals. */
function priceMinor(text: string, currency: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t) || (t.split(".")[1]?.length ?? 0) > minorExponent(currency)) return undefined;
  const minor = toMinor(Number(t), currency);
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= MAX_PRICE ? minor : undefined;
}
const cancelInput = z.object({ orgId: id, bookingId: id, reason: z.string().max(500).refine((s) => s.trim().length > 0) });

const failure = (code?: string): BookingFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "23505" ? "taken" : code === "54000" ? "limit" : code === "55000" ? "stale" : "error";

export function createBookingsService(deps: BookingsDeps) {
  async function run(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | Fail> {
    try {
      const userId = await deps.getUserId();
      if (!userId) return { ok: false, code: "forbidden" };
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
      const { data, error } = await deps.rpc(fn, args);
      return error ? { ok: false, code: failure(error.code) } : { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }
  async function done(r: { ok: true; data: unknown } | Fail, ...paths: string[]): Promise<DoneResult> {
    if (!r.ok) return r;
    for (const p of paths) deps.revalidate(p);
    return { ok: true };
  }

  return {
    async saveSettings(raw: unknown): Promise<DoneResult> {
      const p = settingsInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const v = p.data;
      return done(await run("booking_settings_save", { p_org: v.orgId, p_enabled: v.enabled, p_timezone: v.timezone, p_buffer: v.bufferMinutes,
        p_notice: v.noticeHours, p_horizon: v.horizonDays, p_hours: v.hours.map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })) }), "/settings/bookings");
    },
    async setServiceBooking(raw: unknown): Promise<DoneResult> {
      const p = serviceInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      return done(await run("service_set_booking", { p_org: p.data.orgId, p_service: p.data.serviceId, p_minutes: p.data.minutes }), "/settings/bookings");
    },
    async slots(raw: unknown): Promise<{ ok: true; slots: string[] } | Fail> {
      const p = slotsInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const r = await run("booking_slots", { p_service: p.data.serviceId, p_from: p.data.from, p_to: p.data.to });
      if (!r.ok) return r;
      const rows = Array.isArray(r.data) ? r.data : [];
      if (!rows.every((s) => typeof s === "string" && !Number.isNaN(Date.parse(s)))) return { ok: false, code: "error" };
      return { ok: true, slots: (rows as string[]).map((s) => new Date(s).toISOString()) };
    },
    async request(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
      const p = requestInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const r = await run("booking_request", { p_org: p.data.orgId, p_service: p.data.serviceId, p_start: p.data.start, p_note: p.data.note.trim() });
      if (!r.ok) return r;
      if (typeof r.data !== "string" || !id.safeParse(r.data).success) return { ok: false, code: "error" };
      deps.revalidate("/bookings");
      return { ok: true, id: r.data };
    },
    async decide(raw: unknown): Promise<DoneResult> {
      const p = decideInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      return done(await run("booking_decide", { p_org: p.data.orgId, p_booking: p.data.bookingId, p_confirm: p.data.confirm,
        p_meeting_url: p.data.meetingUrl, p_reason: p.data.reason.trim() }), "/bookings");
    },
    async setServicePrice(raw: unknown): Promise<DoneResult> {
      const p = priceInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const price = priceMinor(p.data.price, p.data.currency);
      if (price === undefined) return { ok: false, code: "invalid" };
      return done(await run("service_set_booking_price", { p_org: p.data.orgId, p_service: p.data.serviceId, p_price: price }), "/settings/bookings");
    },
    /** refund: true when the database queued a refund; the caller then sends it. */
    async cancel(raw: unknown): Promise<CancelResult> {
      const p = cancelInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const r = await run("booking_cancel", { p_org: p.data.orgId, p_booking: p.data.bookingId, p_reason: p.data.reason.trim() });
      if (!r.ok) return r;
      deps.revalidate("/bookings");
      return { ok: true, refund: r.data === "refund_pending", bookingId: p.data.bookingId };
    },
  };
}

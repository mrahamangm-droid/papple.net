import { formatMinor } from "../marketplace/present";
import { isValidUuid } from "../marketplace/validators";

export type BookingFailure = "forbidden" | "invalid" | "taken" | "limit" | "stale" | "rate" | "duplicate" | "refund_failed" | "error";

const LABELS: Record<string, string> = { pending: "Waiting for confirmation", confirmed: "Confirmed", declined: "Declined", cancelled: "Cancelled" };
/** "Expired" is derived: a pending booking whose time has passed. */
export function bookingStatusLabel(status: string, startsAt: string, now: Date = new Date()): string {
  if (status === "pending" && new Date(startsAt).getTime() <= now.getTime()) return "Expired";
  return LABELS[status] ?? "Unknown";
}

const MESSAGES: Record<BookingFailure, string> = {
  forbidden: "You are not allowed to do that.",
  invalid: "Some of the information provided is not valid.",
  taken: "That time was just taken. Please pick another.",
  limit: "Your organization has reached today's limit for booking requests.",
  stale: "This booking is no longer open for that change. Refresh the page to see where it stands.",
  rate: "Too many attempts. Please wait a minute and try again.",
  duplicate: "A payment for this booking is already in progress or complete. Refresh the page to see where it stands.",
  refund_failed: "The booking is cancelled, but the refund could not be sent yet. Use Retry refund on the booking.",
  error: "Something went wrong. Please try again.",
};
export const bookingFailureMessage = (code: BookingFailure): string => MESSAGES[code] ?? MESSAGES.error;

const COPY: Record<string, string> = {
  booking_requested: "You have a new booking request.",
  booking_confirmed: "Your booking was confirmed.",
  booking_declined: "Your booking request was declined.",
  booking_cancelled: "A booking was cancelled.",
  booking_paid: "A booking was paid.",
};
/** Neutral copy and link. Never a name, note or time, so it is safe in email too. */
export function bookingNotificationCopy(type: string, payload: Record<string, unknown>): { text: string; href: string } | null {
  const text = COPY[type];
  if (!text) return null;
  const org = typeof payload.org_id === "string" && isValidUuid(payload.org_id) ? payload.org_id : null;
  return { text, href: org ? `/bookings?org=${org}` : "/bookings" };
}

export interface SlotDay { day: string; label: string; slots: { iso: string; time: string }[] }
/** Groups slot instants by the viewer's local calendar day, in that time zone. */
export function groupSlotsByDay(isoSlots: string[], timeZone: string): SlotDay[] {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const labelFmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const days = new Map<string, SlotDay>();
  for (const iso of isoSlots) {
    const d = new Date(iso);
    const key = dayFmt.format(d);
    if (!days.has(key)) days.set(key, { day: key, label: labelFmt.format(d), slots: [] });
    days.get(key)!.slots.push({ iso, time: timeFmt.format(d) });
  }
  return [...days.values()];
}

export interface PaymentRow { side?: string; client_total?: number | null; status: string; price: number | null; currency: string | null; pay_by: string | null; payment_status: string | null; refund_status: string | null }
export type PaymentKind = "awaiting" | "due" | "overdue" | "paid" | "refund_pending" | "refunded";
/** Where the money for a priced booking stands. "due" carries pay_by so the page can show it in local time. */
export function bookingPaymentState(r: PaymentRow, now: Date = new Date()): { kind: PaymentKind; text: string; payBy?: string } | null {
  if (r.price == null || !r.currency) return null;
  // what the client is charged and refunded (price plus the client fee); the professional also sees its own price
  const total = formatMinor(r.client_total ?? r.price, r.currency);
  const amount = r.side === "provider" ? `${total} by the client (your price ${formatMinor(r.price, r.currency)})` : total;
  if (r.refund_status === "succeeded" || r.payment_status === "refunded") return { kind: "refunded", text: `Refunded ${amount}` };
  if (r.refund_status === "pending" || r.payment_status === "refund_pending") return { kind: "refund_pending", text: `Refund of ${amount} pending` };
  if (r.payment_status === "succeeded") return { kind: "paid", text: `Paid ${amount}` };
  if (r.status === "pending") return { kind: "awaiting", text: `${amount}, paid after confirmation` };
  if (r.status !== "confirmed" || !r.pay_by) return null;
  if (new Date(r.pay_by).getTime() <= now.getTime()) return { kind: "overdue", text: `Payment of ${amount} overdue` };
  return { kind: "due", text: `Payment of ${amount} due by`, payBy: r.pay_by };
}

/** The price line on the public booking picker, or null for a free service. */
export function bookingPriceLine(offer: { price: number; currency: string } | null): string | null {
  return offer ? `${formatMinor(offer.price, offer.currency)} per session, paid after the professional confirms.` : null;
}

/** The cancellation rule in plain words, for the picker and the bookings page. */
export function bookingRefundRule(cutoffHours: number): string {
  const pro = "If the professional cancels, you get a full refund.";
  if (cutoffHours <= 0) return `Cancel any time before the start for a full refund. ${pro}`;
  const span = `${cutoffHours} hour${cutoffHours === 1 ? "" : "s"}`;
  return `Cancel at least ${span} before the start for a full refund; later cancellations are not refunded. ${pro}`;
}

/** Same boundary as booking_cancel: refunded when starts_at - now >= the cut-off. */
export function clientCancelForfeits(r: { side: string; payment_status: string | null; starts_at: string }, cutoffHours: number, now: Date = new Date()): boolean {
  return r.side === "client" && r.payment_status === "succeeded" && new Date(r.starts_at).getTime() - now.getTime() < cutoffHours * 3_600_000;
}

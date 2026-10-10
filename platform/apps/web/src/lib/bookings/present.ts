import { isValidUuid } from "../marketplace/validators";

export type BookingFailure = "forbidden" | "invalid" | "taken" | "limit" | "stale" | "rate" | "error";

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
  error: "Something went wrong. Please try again.",
};
export const bookingFailureMessage = (code: BookingFailure): string => MESSAGES[code] ?? MESSAGES.error;

const COPY: Record<string, string> = {
  booking_requested: "You have a new booking request.",
  booking_confirmed: "Your booking was confirmed.",
  booking_declined: "Your booking request was declined.",
  booking_cancelled: "A booking was cancelled.",
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

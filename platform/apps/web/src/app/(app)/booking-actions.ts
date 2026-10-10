"use server";
import { revalidatePath } from "next/cache";
import { bookingPayments, bookingsService } from "@/lib/server";

const revalidate = (path: string) => revalidatePath(path);
const service = () => bookingsService(revalidate);
const payments = () => bookingPayments(revalidate);

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveBookingSettingsAction(input: unknown) { return service().saveSettings(input); }
export async function setServiceBookingAction(input: unknown) { return service().setServiceBooking(input); }
export async function setServicePriceAction(input: unknown) { return service().setServicePrice(input); }
export async function bookingSlotsAction(input: unknown) { return service().slots(input); }
export async function requestBookingAction(input: unknown) { return service().request(input); }
export async function decideBookingAction(input: unknown) { return service().decide(input); }
export async function payBookingAction(input: unknown) { return payments().pay(input); }
export async function retryBookingRefundAction(input: unknown) { return payments().retryRefund(input); }

/** Cancels, then sends the refund the database queued (if any). A failed send leaves the refund pending for Retry refund. */
export async function cancelBookingAction(input: unknown) {
  const r = await service().cancel(input);
  if (!r.ok || !r.refund) return r;
  const bookingId = (input as { bookingId: string }).bookingId; // validated by cancel()
  const sent = await payments().sendRefund(bookingId);
  return sent.ok ? r : { ok: false as const, code: "refund_failed" as const };
}

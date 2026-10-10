"use server";
import { revalidatePath } from "next/cache";
import { bookingsService } from "@/lib/server";

const service = () => bookingsService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveBookingSettingsAction(input: unknown) { return service().saveSettings(input); }
export async function setServiceBookingAction(input: unknown) { return service().setServiceBooking(input); }
export async function bookingSlotsAction(input: unknown) { return service().slots(input); }
export async function requestBookingAction(input: unknown) { return service().request(input); }
export async function decideBookingAction(input: unknown) { return service().decide(input); }
export async function cancelBookingAction(input: unknown) { return service().cancel(input); }

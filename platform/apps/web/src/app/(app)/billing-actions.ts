"use server";
import { billingService } from "@/lib/server";

// "use server" files may only export async functions, so each action is wrapped individually.
export async function startCheckoutAction(input: unknown) { return billingService.startCheckout(input); }
export async function openPortalAction(input: unknown) { return billingService.openPortal(input); }

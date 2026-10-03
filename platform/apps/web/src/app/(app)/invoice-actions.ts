"use server";
import { revalidatePath } from "next/cache";
import { invoiceService } from "@/lib/server";

const service = () => invoiceService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function issueInvoiceAction(input: unknown) { return service().issue(input); }
export async function issueCreditNoteAction(input: unknown) { return service().creditNote(input); }
export async function saveBillingProfileAction(input: unknown) { return service().saveProfile(input); }

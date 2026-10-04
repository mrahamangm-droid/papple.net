"use server";
import { revalidatePath } from "next/cache";
import { crmEmailService } from "@/lib/server";

const service = () => crmEmailService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function sendCrmEmailAction(input: unknown) { return service().sendEmail(input); }
export async function setContactBasisAction(input: unknown) { return service().setBasis(input); }

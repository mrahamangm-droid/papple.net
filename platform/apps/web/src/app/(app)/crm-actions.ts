"use server";
import { revalidatePath } from "next/cache";
import { crmService } from "@/lib/server";

const service = () => crmService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveContactAction(input: unknown) { return service().saveContact(input); }
export async function deleteContactAction(input: unknown) { return service().deleteContact(input); }
export async function importContactsAction(input: unknown) { return service().importCsv(input); }
export async function saveDealAction(input: unknown) { return service().saveDeal(input); }
export async function addNoteAction(input: unknown) { return service().addNote(input); }
export async function completeNoteAction(input: unknown) { return service().completeNote(input); }

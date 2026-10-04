"use server";
import { revalidatePath } from "next/cache";
import { credentialService } from "@/lib/server";

const service = () => credentialService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveCredentialAction(input: unknown) { return service().save(input); }
export async function deleteCredentialAction(input: unknown) { return service().remove(input); }
export async function requestCredentialCheckAction(input: unknown) { return service().requestCheck(input); }

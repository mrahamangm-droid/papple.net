"use server";
import { revalidatePath } from "next/cache";
import { apiKeyService } from "@/lib/server";

const service = () => apiKeyService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function createApiKeyAction(input: unknown) { return service().create(input); }
export async function revokeApiKeyAction(input: unknown) { return service().revoke(input); }

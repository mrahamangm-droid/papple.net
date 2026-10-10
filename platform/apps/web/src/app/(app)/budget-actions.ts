"use server";
import { revalidatePath } from "next/cache";
import { budgetsService } from "@/lib/server";

// "use server" files may only export async functions.
export async function saveBudgetAction(input: unknown) { return budgetsService((path) => revalidatePath(path)).save(input); }

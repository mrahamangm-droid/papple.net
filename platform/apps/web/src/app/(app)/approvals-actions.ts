"use server";
import { revalidatePath } from "next/cache";
import { approvalsService } from "@/lib/server";

const service = () => approvalsService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function setSpendPolicyAction(input: unknown) { return service().setPolicy(input); }
export async function decideSpendRequestAction(input: unknown) { return service().decide(input); }
export async function withdrawSpendRequestAction(input: unknown) { return service().withdraw(input); }

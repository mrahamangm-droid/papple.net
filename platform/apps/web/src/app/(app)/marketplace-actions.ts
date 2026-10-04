"use server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { createActions } from "@/lib/marketplace/actions";
import { marketplaceDb, throttle } from "@/lib/server";

const actions = createActions({
  db: marketplaceDb,
  auth: async () => {
    const ctx = await getAuthContext();
    return ctx ? { userId: ctx.userId } : null;
  },
  throttle,
  revalidate: (p) => revalidatePath(p),
});

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveProfile(input: unknown) { return actions.saveProfile(input); }
export async function saveService(input: unknown) { return actions.saveService(input); }
export async function saveProject(input: unknown) { return actions.saveProject(input); }
export async function submitProposalAction(input: unknown) { return actions.submitProposalAction(input); }
export async function decideProposal(input: unknown) { return actions.decideProposal(input); }
export async function startThread(input: unknown) { return actions.startThread(input); }
export async function postMessage(input: unknown) { return actions.postMessage(input); }
export async function reportContent(input: unknown) { return actions.reportContent(input); }
export async function changeProjectStatus(input: unknown) { return actions.changeProjectStatus(input); }
export async function withdrawProposalAction(input: unknown) { return actions.withdrawProposalAction(input); }
export async function markRead(input: unknown) { return actions.markRead(input); }

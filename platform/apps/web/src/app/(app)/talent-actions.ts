"use server";
import { revalidatePath } from "next/cache";
import { talentService } from "@/lib/server";

const service = () => talentService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function savePoolAction(input: unknown) { return service().savePool(input); }
export async function deletePoolAction(input: unknown) { return service().deletePool(input); }
export async function setPoolMemberAction(input: unknown) { return service().setMember(input); }
export async function removePoolMemberAction(input: unknown) { return service().removeMember(input); }
export async function inviteToProjectAction(input: unknown) { return service().invite(input); }
export async function declineInvitationAction(input: unknown) { return service().decline(input); }

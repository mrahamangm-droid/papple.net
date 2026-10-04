"use server";
import { revalidatePath } from "next/cache";
import { teamService } from "@/lib/server";

const service = () => teamService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function inviteMemberAction(input: unknown) { return service().invite(input); }
export async function revokeInviteAction(input: unknown) { return service().revoke(input); }
export async function setMemberRoleAction(input: unknown) { return service().setRole(input); }
export async function removeMemberAction(input: unknown) { return service().remove(input); }
export async function leaveOrganizationAction(input: unknown) { return service().leave(input); }
export async function acceptInviteAction(token: string) { return service().accept(token); }

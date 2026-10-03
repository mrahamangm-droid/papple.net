"use server";
import { aiService } from "@/lib/server";

// "use server" files may only export async functions, so each action is wrapped individually.
export async function draftProposalAi(input: unknown) { return aiService.draftProposal(input); }
export async function polishTextAi(input: unknown) { return aiService.polish(input); }
export async function improveBriefAi(input: unknown) { return aiService.improveBrief(input); }

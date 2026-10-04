import { z } from "zod";

const id = z.uuid();
const MAX_MINOR = 2_147_483_647;

export const hireInput = z.object({ orgId: id, proposalId: id, projectId: id });

export const milestoneItem = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  amount: z.number().int().min(1).max(MAX_MINOR),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const setMilestonesInput = z.object({ orgId: id, contractId: id, items: z.array(milestoneItem).min(1).max(100) });

export const contractRef = z.object({ orgId: id, contractId: id });
export const activateInput = z.object({ contractId: id });
export const milestoneRef = z.object({ orgId: id, contractId: id, milestoneId: id });
export const requestChangesInput = milestoneRef.extend({ note: z.string().trim().min(1).max(1000) });
export const cancelInput = contractRef.extend({ reason: z.string().trim().max(1000).default("") });
export const disputeInput = contractRef.extend({ reason: z.string().trim().min(10).max(2000) });
export const reviewInput = contractRef.extend({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).default("") });
export const payoutInput = z.object({ orgId: id });

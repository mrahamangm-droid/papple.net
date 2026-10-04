import { z } from "zod";

export const OUTCOMES = ["resume", "complete", "cancel", "refund_cancel"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ruleDisputeInput = z.object({
  disputeId: z.uuid(),
  outcome: z.enum(OUTCOMES),
  note: z.string().trim().min(10).max(1000),
});
export const retryRefundsInput = z.object({ disputeId: z.uuid() });

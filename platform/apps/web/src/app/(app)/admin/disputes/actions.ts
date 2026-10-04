"use server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { createDisputeActions } from "@/lib/disputes/actions";
import { retryRefundsInput, ruleDisputeInput } from "@/lib/disputes/validators";
import { adminAction, disputesDb, refundService } from "@/lib/server";

const actions = createDisputeActions({
  db: disputesDb,
  // Lazy: refunds need Stripe keys, and importing this file must not.
  refunds: { issueForDispute: (id) => refundService().issueForDispute(id) },
  revalidate: (p) => revalidatePath(p),
  hasSecondFactor: async () => (await getAuthContext())?.aal === "aal2",
});

// Platform admin check, input validation and the audit entry come from the admin wrapper. "use server" files may only export async functions.
const rule = adminAction({ name: "dispute.rule", input: ruleDisputeInput, handler: (i) => actions.rule(i) });
const retry = adminAction({ name: "dispute.refund_retry", input: retryRefundsInput, handler: (i) => actions.retry(i) });

export async function ruleDisputeAction(input: unknown) { return rule(input); }
export async function retryRefundsAction(input: unknown) { return retry(input); }

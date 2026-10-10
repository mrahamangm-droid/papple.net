import { MarketplaceError, mapDbError } from "../marketplace/errors";
import type { AcceptOutcome } from "../approvals/present";
import type { Rpc } from "../marketplace/db";

export interface MilestoneInput { title: string; description: string; amount: number; dueDate?: string }
export interface Approval {
  payment_id: string; milestone_id: string; contract_id: string; title: string;
  amount: number; client_fee: number; provider_fee: number; client_total: number; application_fee: number;
  currency: string; previous_session: string | null;
}

/** Thin typed wrappers over the contract RPCs. Every call names its organization; the database re-checks the role. */
export function createContractsDb(rpc: Rpc) {
  async function call<T = void>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await rpc(fn, args);
    if (error) throw mapDbError(error);
    return data as T;
  }
  return {
    hire: (i: { orgId: string; proposalId: string }) => call<string>("create_contract", { p_org: i.orgId, p_proposal: i.proposalId }),
    setMilestones: (i: { orgId: string; contractId: string; items: MilestoneInput[] }) => call("set_milestones", {
      p_org: i.orgId, p_contract: i.contractId,
      p_items: i.items.map((m) => ({ title: m.title, description: m.description, amount: m.amount, due_date: m.dueDate ?? null })),
    }),
    /** "accepted", or the client organization's approval rule sent it to the owners instead. */
    acceptContract: async (orgId: string, contractId: string): Promise<AcceptOutcome> => {
      const out = await call<string>("accept_contract", { p_org: orgId, p_contract: contractId });
      if (out !== "accepted" && out !== "approval_requested" && out !== "approval_pending") throw new MarketplaceError();
      return out;
    },
    activateContract: (contractId: string) => call("activate_contract", { p_contract: contractId }),
    submitMilestone: (orgId: string, milestoneId: string) => call("submit_milestone", { p_org: orgId, p_milestone: milestoneId }),
    requestChanges: (orgId: string, milestoneId: string, note: string) => call("request_changes", { p_org: orgId, p_milestone: milestoneId, p_note: note }),
    cancelContract: (orgId: string, contractId: string, reason: string) => call("cancel_contract", { p_org: orgId, p_contract: contractId, p_reason: reason }),
    approveMilestone: (orgId: string, milestoneId: string) => call<Approval>("approve_milestone", { p_org: orgId, p_milestone: milestoneId }),
    raiseDispute: (i: { orgId: string; contractId: string; reason: string }) => call<string>("raise_dispute", { p_org: i.orgId, p_contract: i.contractId, p_reason: i.reason }),
    postReview: (i: { orgId: string; contractId: string; rating: number; comment: string }) =>
      call<string>("post_review", { p_org: i.orgId, p_contract: i.contractId, p_rating: i.rating, p_comment: i.comment }),
    assertCanManagePayouts: (orgId: string) => call("assert_can_manage_payouts", { p_org: orgId }),
  };
}
export type ContractsDb = ReturnType<typeof createContractsDb>;

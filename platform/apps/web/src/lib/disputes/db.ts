import type { Rpc } from "../marketplace/db";
import { mapDbError } from "../marketplace/errors";
import type { Outcome } from "./validators";

/** Runs through the signed-in admin's own session: the database checks platform staff and aal2 from that session. Never the service client. */
export function createDisputesDb(rpc: Rpc) {
  return {
    async resolveDispute(i: { disputeId: string; outcome: Outcome; note: string }): Promise<void> {
      const { error } = await rpc("resolve_dispute", { p_dispute: i.disputeId, p_outcome: i.outcome, p_note: i.note });
      if (error) throw mapDbError(error);
    },
  };
}
export type DisputesDb = ReturnType<typeof createDisputesDb>;

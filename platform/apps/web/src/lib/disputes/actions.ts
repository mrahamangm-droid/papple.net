import { InvalidInputError, NotAllowedError } from "../marketplace/errors";
import type { RefundService } from "../payments/refunds";
import type { DisputesDb } from "./db";
import { retryRefundsInput, ruleDisputeInput } from "./validators";

export type DisputeActionResult =
  | { ok: true; issued: number; failed: number; retryNeeded?: boolean }
  | { ok: false; code: "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "error" };

interface Deps {
  db: Pick<DisputesDb, "resolveDispute">;
  refunds: Pick<RefundService, "issueForDispute">;
  revalidate: (path: string) => void;
  /** The admin's session is at aal2. The database checks this for rulings; Retry calls Stripe with the service role, so it is checked here. */
  hasSecondFactor: () => Promise<boolean>;
}

/**
 * Admin actions. Platform-admin and audit wrapping happen where these are exposed (createAdminAction); these never throw for expected
 * failures. The ruling is committed by the database before any Stripe call, so a Stripe outage never loses a ruling: it leaves refunds pending.
 */
export function createDisputeActions(deps: Deps) {
  const paths = (id: string) => ["/admin/disputes", `/admin/disputes/${id}`];
  const fail = (e: unknown): DisputeActionResult => {
    if (e instanceof NotAllowedError) return { ok: false, code: "forbidden" };
    if (e instanceof InvalidInputError) return { ok: false, code: "invalid" };
    return { ok: false, code: "error" };
  };
  return {
    async rule(raw: unknown): Promise<DisputeActionResult> {
      const parsed = ruleDisputeInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      if (!(await deps.hasSecondFactor())) return { ok: false, code: "forbidden" };
      const v = parsed.data;
      try {
        await deps.db.resolveDispute(v);
      } catch (e) {
        return fail(e);
      }
      for (const p of paths(v.disputeId)) deps.revalidate(p);
      if (v.outcome !== "refund_cancel") return { ok: true, issued: 0, failed: 0 };
      try {
        const r = await deps.refunds.issueForDispute(v.disputeId);
        return { ok: true, ...r };
      } catch {
        return { ok: true, issued: 0, failed: 0, retryNeeded: true };
      }
    },
    async retry(raw: unknown): Promise<DisputeActionResult> {
      const parsed = retryRefundsInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      if (!(await deps.hasSecondFactor())) return { ok: false, code: "forbidden" };
      try {
        const r = await deps.refunds.issueForDispute(parsed.data.disputeId);
        for (const p of paths(parsed.data.disputeId)) deps.revalidate(p);
        return { ok: true, ...r };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}

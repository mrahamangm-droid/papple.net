import type { Outcome } from "./validators";

export const OUTCOME_COPY: Record<Outcome, { label: string; help: string }> = {
  resume: { label: "Resume the contract", help: "Dismiss the dispute. The contract goes back to active (or completed if every milestone is paid). No money moves." },
  complete: { label: "Mark as completed", help: "Close the contract as completed. No money moves." },
  cancel: { label: "Cancel without refund", help: "Cancel the contract. Payments already made stay with the professional." },
  refund_cancel: { label: "Cancel and refund the client", help: "Cancel the contract and refund every paid milestone in full, including Papple's fee. The professional's transfer is reversed." },
};

/** What the ruling form may offer. The database re-checks everything; a refund is only offered when there is something to refund. */
export function rulingChoices(paymentStatuses: string[]): Outcome[] {
  const base: Outcome[] = ["resume", "complete", "cancel"];
  return paymentStatuses.includes("succeeded") ? [...base, "refund_cancel"] : base;
}

/** Oldest dispute first: the one that has waited longest is worked first. */
export function sortQueue<T extends { opened_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
}

export function refundState(refunds: { status: string }[]) {
  const count = (s: string) => refunds.filter((r) => r.status === s).length;
  const pending = count("pending");
  return { pending, succeeded: count("succeeded"), failed: count("failed"), canRetry: pending > 0 };
}

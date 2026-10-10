import { formatMinor } from "../marketplace/present";
import { isValidUuid } from "../marketplace/validators";

export type ApprovalFailure = "forbidden" | "invalid" | "duplicate" | "stale" | "rate" | "error";
export type AcceptOutcome = "accepted" | "approval_requested" | "approval_pending";
export type DecideOutcome = "approved" | "partial" | "rejected" | "lapsed";

const LABELS: Record<string, string> = {
  pending: "Waiting for an owner", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", lapsed: "Lapsed (terms changed)",
};
export const requestStatusLabel = (s: string) => LABELS[s] ?? "Unknown";

const MESSAGES: Record<ApprovalFailure, string> = {
  forbidden: "You are not allowed to do that.",
  invalid: "Some of the information provided is not valid.",
  duplicate: "That already exists.",
  stale: "This request was already decided or withdrawn. Refresh the page to see where it stands.",
  rate: "Too many attempts. Please wait a minute and try again.",
  error: "Something went wrong. Please try again.",
};
export const approvalFailureMessage = (code: ApprovalFailure): string => MESSAGES[code] ?? MESSAGES.error;

/** What to tell someone after "Accept terms" when the database sent the contract for approval instead. An owner in a tier
 *  that needs two or more owners has only given the first approval. */
export function acceptOutcomeMessage(o: AcceptOutcome | undefined, isOwner = false): string | null {
  if (o !== "approval_requested" && o !== "approval_pending") return null;
  return isOwner ? "Your approval is recorded. Another owner must approve before the contract is accepted." : "Sent to your organization's owners for approval.";
}

/** Shown after Approve or Reject; null when the page refresh says it all. */
export function decideOutcomeMessage(o: string | undefined): string | null {
  if (o === "partial") return "Your approval is recorded. Another owner must also approve.";
  if (o === "lapsed") return "The terms changed after this request was made, so it lapsed. The admin can accept again to send a new request.";
  return null;
}

/** "1 of 2 owner approvals"; stuck when the owners who could still approve are too few to finish (it never downgrades). */
export function approvalProgress(p: { required: number; approvedBy: string[]; eligibleLeft: number }): { text: string; stuck: boolean } {
  const got = p.approvedBy.length;
  const stuck = got + p.eligibleLeft < p.required;
  const base = got === 0
    ? `Needs ${p.required} owner approval${p.required === 1 ? "" : "s"}`
    : `${got} of ${p.required} owner approvals (approved by ${p.approvedBy.join(", ")})`;
  return { text: stuck ? `${base}. It cannot be completed: not enough owners are left to approve.` : base, stuck };
}

export interface SpendTier { min_minor: number; approvals: number }
export function tierSummary(tiers: SpendTier[], currency: string): string {
  if (tiers.length === 0) return "One owner approval for every request.";
  return [...tiers].sort((a, b) => a.min_minor - b.min_minor)
    .map((t) => `From ${formatMinor(t.min_minor, currency)}: ${t.approvals === 1 ? "1 owner approval" : `${t.approvals} different owners`}.`).join(" ");
}

/** The database decides; these only choose which buttons to show. */
export const canDecide = (role: string, requestedBy: string | null, userId: string) => role === "owner" && requestedBy !== userId;
export const isManager = (m: { role: string }) => m.role === "owner" || m.role === "admin";
export const canWithdraw = (role: string, requestedBy: string | null, userId: string) => role === "owner" || requestedBy === userId;

const COPY: Record<string, string> = {
  spend_approval_requested: "A contract is waiting for your approval.",
  spend_request_approved: "Your contract approval was granted.",
  spend_request_rejected: "Your contract approval was declined.",
  spend_request_progress: "An owner approved your contract; another approval is still needed.",
};

/** Neutral copy and link. Never an amount, so it is safe in email too. */
export function approvalNotificationCopy(type: string, payload: Record<string, unknown>): { text: string; href: string } | null {
  const text = COPY[type];
  if (!text) return null;
  const contract = typeof payload.contract_id === "string" ? payload.contract_id : null;
  const org = typeof payload.org_id === "string" && isValidUuid(payload.org_id) ? payload.org_id : null;
  if (type === "spend_request_approved" && contract) return { text, href: `/contracts/${contract}` };
  return { text, href: org ? `/approvals?org=${org}` : "/approvals" };
}

export interface SpendPolicy { enabled: boolean; threshold_minor: number; currency: string }

export function policySummary(p: SpendPolicy | null): string {
  if (!p || !p.enabled) return "No approval rule. Owners and admins accept contracts directly.";
  return `Contracts of ${formatMinor(p.threshold_minor, p.currency)} or more, or in a currency other than ${p.currency}, need an owner's approval when an admin accepts them.`;
}

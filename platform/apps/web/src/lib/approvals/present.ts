import { formatMinor } from "../marketplace/present";
import { isValidUuid } from "../marketplace/validators";

export type ApprovalFailure = "forbidden" | "invalid" | "duplicate" | "rate" | "error";
export type AcceptOutcome = "accepted" | "approval_requested" | "approval_pending";
export type DecideOutcome = "approved" | "rejected" | "lapsed";

const LABELS: Record<string, string> = {
  pending: "Waiting for an owner", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", lapsed: "Lapsed (terms changed)",
};
export const requestStatusLabel = (s: string) => LABELS[s] ?? "Unknown";

const MESSAGES: Record<ApprovalFailure, string> = {
  forbidden: "You are not allowed to do that.",
  invalid: "Some of the information provided is not valid.",
  duplicate: "That already exists.",
  rate: "Too many attempts. Please wait a minute and try again.",
  error: "Something went wrong. Please try again.",
};
export const approvalFailureMessage = (code: ApprovalFailure): string => MESSAGES[code] ?? MESSAGES.error;

/** What to tell an admin after "Accept terms" when the database sent the contract to the owners instead. */
export function acceptOutcomeMessage(o: AcceptOutcome | undefined): string | null {
  return o === "approval_requested" || o === "approval_pending" ? "Sent to your organization's owners for approval." : null;
}

/** The database decides; these only choose which buttons to show. */
export const canDecide = (role: string, requestedBy: string | null, userId: string) => role === "owner" && requestedBy !== userId;
export const isManager = (m: { role: string }) => m.role === "owner" || m.role === "admin";
export const canWithdraw = (role: string, requestedBy: string | null, userId: string) => role === "owner" || requestedBy === userId;

const COPY: Record<string, string> = {
  spend_approval_requested: "A contract is waiting for your approval.",
  spend_request_approved: "Your contract approval was granted.",
  spend_request_rejected: "Your contract approval was declined.",
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

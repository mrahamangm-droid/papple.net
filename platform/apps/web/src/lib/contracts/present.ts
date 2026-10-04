export type Role = "owner" | "admin" | "member" | "viewer";
export type Side = "client" | "provider";

export function viewerSide(contract: { client_org_id: string; provider_org_id: string }, mine: { id: string; role: Role }[]): { side: Side; orgId: string; role: Role } | null {
  const c = mine.find((o) => o.id === contract.client_org_id);
  if (c) return { side: "client", orgId: c.id, role: c.role };
  const p = mine.find((o) => o.id === contract.provider_org_id);
  if (p) return { side: "provider", orgId: p.id, role: p.role };
  return null;
}

const MANAGERS: Role[] = ["owner", "admin"];
const STAFF: Role[] = ["owner", "admin", "member"];

/** What the buttons may offer. The database re-checks every action; this only avoids offering impossible ones. */
export function milestoneActions(i: { side: Side; role: Role; contractStatus: string; milestoneStatus: string }) {
  const live = i.contractStatus === "active";
  return {
    submit: live && i.side === "provider" && STAFF.includes(i.role) && ["pending", "changes_requested"].includes(i.milestoneStatus),
    approve: live && i.side === "client" && MANAGERS.includes(i.role) && ["submitted", "approved"].includes(i.milestoneStatus),
    requestChanges: live && i.side === "client" && STAFF.includes(i.role) && i.milestoneStatus === "submitted",
  };
}

export function contractActions(i: {
  side: Side; role: Role; hasReviewed: boolean;
  contract: { status: string; accepted_by_client: boolean; accepted_by_provider: boolean };
}) {
  const c = i.contract;
  const draft = c.status === "draft";
  const manager = MANAGERS.includes(i.role);
  const mineAccepted = i.side === "client" ? c.accepted_by_client : c.accepted_by_provider;
  return {
    editMilestones: draft && STAFF.includes(i.role),
    accept: draft && manager && !mineAccepted,
    activate: draft && manager && c.accepted_by_client && c.accepted_by_provider,
    cancel: draft && manager,
    dispute: c.status === "active" && manager,
    review: c.status === "completed" && manager && !i.hasReviewed,
  };
}

const CONTRACT_LABELS: Record<string, string> = { draft: "Draft", active: "Active", completed: "Completed", cancelled: "Cancelled", disputed: "In dispute" };
const MILESTONE_LABELS: Record<string, string> = { pending: "Not started", submitted: "Waiting for approval", changes_requested: "Changes requested", approved: "Approved, payment due", paid: "Paid" };
export const contractStatusLabel = (s: string) => CONTRACT_LABELS[s] ?? "Unknown";
export const milestoneStatusLabel = (s: string) => MILESTONE_LABELS[s] ?? "Unknown";
export const milestoneTotal = (items: { amount: number }[]) => items.reduce((n, m) => n + m.amount, 0);

const COPY: Record<string, string> = {
  contract_offered: "You have a new contract offer.",
  contract_active: "A contract is now active.",
  contract_cancelled: "A contract draft was cancelled.",
  contract_completed: "A contract is complete. You can leave a review.",
  milestone_submitted: "A milestone is waiting for your approval.",
  milestone_changes_requested: "Changes were requested on a milestone.",
  payment_received: "A milestone payment was completed.",
  dispute_opened: "A dispute was opened on a contract.",
  dispute_resolved: "A dispute was resolved.",
};

/** Neutral copy and deep link for contract notifications. No amounts or names, so it is safe in email too. */
export function notificationCopy(type: string, payload: Record<string, unknown>): { text: string; href: string } | null {
  const text = COPY[type];
  if (!text) return null;
  const id = typeof payload.contract_id === "string" ? payload.contract_id : null;
  return { text, href: id ? `/contracts/${id}` : "/contracts" };
}

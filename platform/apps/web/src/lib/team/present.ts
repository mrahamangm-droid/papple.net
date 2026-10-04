export type TeamRole = "owner" | "admin" | "member" | "viewer";
export type TeamFailure = "forbidden" | "invalid" | "duplicate" | "limit" | "notready" | "owner_required" | "rate" | "error";

const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
export const roleLabel = (r: string): string => ROLE_LABEL[r as TeamRole] ?? "Unknown";
export const ROLE_HELP: Record<TeamRole, string> = {
  owner: "Full control, including billing and who else is an owner.",
  admin: "Manages members and viewers, invoicing and payouts.",
  member: "Works in the organization: proposals, contracts, messages, CRM.",
  viewer: "Can look but not change anything.",
};

// These mirror the database rules only to decide which buttons to show; the database is what enforces them.
export const canInvite = (caller: string): boolean => caller === "owner" || caller === "admin";
export const assignableRoles = (caller: string): Array<"admin" | "member" | "viewer"> =>
  caller === "owner" ? ["admin", "member", "viewer"] : caller === "admin" ? ["member", "viewer"] : [];
export function canChangeMember(caller: string, target: string, isSelf: boolean): TeamRole[] {
  void isSelf;
  if (caller === "owner") return ["owner", "admin", "member", "viewer"];
  if (caller === "admin" && (target === "member" || target === "viewer")) return ["member", "viewer"];
  return [];
}
export function canRemoveMember(caller: string, target: string, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (caller === "owner") return true;
  return caller === "admin" && (target === "member" || target === "viewer");
}

const MESSAGES: Record<TeamFailure, string> = {
  forbidden: "You do not have permission to do that for this organization.",
  invalid: "Some details are missing or not valid. Check them and try again.",
  duplicate: "That person is already on the team or already has a pending invite.",
  limit: "Your plan's seat limit or today's invite limit is reached. Remove a pending invite, upgrade your plan, or try again tomorrow.",
  notready: "This organization cannot add people right now.",
  owner_required: "An organization must keep at least one owner. Make another person an owner first.",
  rate: "You are going a little fast. Wait a moment and try again.",
  error: "Something went wrong. Please try again.",
};
export const teamFailureMessage = (code: TeamFailure): string => MESSAGES[code] ?? MESSAGES.error;

export function seatSummary(u: { members: number; pending: number; limit: number | null }): string {
  const m = `${u.members} member${u.members === 1 ? "" : "s"}`, p = `${u.pending} pending invite${u.pending === 1 ? "" : "s"}`;
  if (u.limit === null) return `${m}, ${p}. Your plan has no seat limit.`;
  const used = u.members + u.pending;
  const base = `${used} of ${u.limit} seats used (${m}, ${p})`;
  return used >= u.limit ? `${base}. Seat limit reached.` : base;
}

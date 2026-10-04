export type TalentFailure = "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "error";

/** "Rust, go ,RUST" -> ["rust","go"]. Tags are private labels the organization uses to find people again. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const AVAILABILITY: Record<string, string> = { available: "Available", limited: "Limited availability", unavailable: "Unavailable" };
export const availabilityLabel = (a: string): string => AVAILABILITY[a] ?? "Unknown";

export const inviteStatusLabel = (s: string): string => (s === "declined" ? "You declined" : "Waiting for your answer");

const MESSAGES: Record<TalentFailure, string> = {
  forbidden: "You do not have permission to do that. Pools are managed by members of a client, agency or enterprise organization.",
  invalid: "Some details are missing or not valid. Check the name, note, tags (up to 10) and message (10 to 1000 characters). The professional must still have a public profile and the project must be open.",
  limit: "A plan limit was reached: pools, professionals per pool or invitations today. Remove something or upgrade your plan.",
  duplicate: "That already exists: a pool with this name, or an invitation to this professional for this project.",
  rate: "You are going a little fast. Wait a moment and try again.",
  error: "Something went wrong. Please try again.",
};
export const talentFailureMessage = (code: TalentFailure): string => MESSAGES[code] ?? MESSAGES.error;

/** Notification line for a project invitation; it links to the inbox, where the message and the decline action live. */
export function inviteNotificationCopy(type: string, payload: Record<string, unknown>): { text: string; href: string } | null {
  if (type !== "project_invite") return null;
  const from = typeof payload.from === "string" ? payload.from.slice(0, 120) : "";
  const title = typeof payload.project_title === "string" ? payload.project_title.slice(0, 150) : "";
  return { text: from && title ? `${from} invited you to "${title}".` : "You have a new project invitation.", href: "/invitations" };
}

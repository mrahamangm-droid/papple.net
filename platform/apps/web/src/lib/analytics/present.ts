import { z } from "zod";

export type AnalyticsFailure = "forbidden" | "invalid" | "rate" | "error";

const count = z.number().int().nonnegative();
const ratio = z.number().nonnegative().nullable();
const minor = z.number().int().nonnegative();

const analyticsSchema = z.object({
  days: z.number().int().positive(),
  requested_days: z.number().int().positive(),
  capped: z.boolean(),
  since: z.string(),
  projects: z.object({ posted: count, open: count, closed: count, cancelled: count, other: count }),
  proposals: z.object({ received: count, shortlisted: count, avg_per_project: ratio }),
  hiring: z.object({ hired: count, hire_rate_pct: ratio, median_days_to_hire: ratio }),
  contracts: z.object({ draft: count, active: count, completed: count, disputed: count, cancelled: count }),
  money: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), committed: minor, paid: minor, client_fees: minor, refunded: minor })),
  top_providers: z.array(z.object({ name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/), contracts: count, committed: minor })),
  talent: z.object({ pools: count, pooled: count, invites_sent: count, invites_declined: count, proposals_from_invited: count, invite_to_proposal_pct: ratio }),
  monthly: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), projects: count, contracts: count })),
});
export type Analytics = z.infer<typeof analyticsSchema>;

/** The database is trusted to be right, not to be well-shaped: anything unexpected is refused rather than shown. */
export function parseAnalytics(raw: unknown): Analytics | null {
  const p = analyticsSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export const NO_DATA = "Not enough data yet";
const trim = (n: number) => String(Math.round(n * 10) / 10);
export const formatPct = (n: number | null): string => (n == null ? NO_DATA : `${trim(n)}%`);
export const formatDays = (n: number | null): string => (n == null ? NO_DATA : `${trim(n)} ${n === 1 ? "day" : "days"}`);

export const WINDOWS = [30, 90, 365] as const;
export type Window = (typeof WINDOWS)[number];
export function normalizeDays(raw: string | string[] | undefined): Window {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (WINDOWS as readonly number[]).includes(v) ? (v as Window) : 30;
}

export function windowNote(a: { days: number; requested_days: number; capped: boolean }): string | null {
  return a.capped ? `Your plan shows up to ${a.days} days of history, so this is the last ${a.days} days instead of ${a.requested_days}.` : null;
}

const MESSAGES: Record<AnalyticsFailure, string> = {
  forbidden: "Only owners and admins of a client, agency or enterprise organization can see hiring analytics.",
  invalid: "That organization or time window is not valid.",
  rate: "You are going a little fast. Wait a moment and try again.",
  error: "Analytics could not be loaded. Please try again.",
};
export const analyticsFailureMessage = (code: AnalyticsFailure): string => MESSAGES[code] ?? MESSAGES.error;

/** What each number counts, shown on the page so nobody has to guess. */
export const DEFINITIONS: { term: string; text: string }[] = [
  { term: "Posted", text: "Projects you created in the window that are not drafts." },
  { term: "Proposals received", text: "Proposals sent to those projects. Average is per posted project." },
  { term: "Hire rate", text: "Posted projects that have an accepted contract (active, completed or disputed), out of all posted projects. An offer the professional has not accepted yet is not a hire." },
  { term: "Time to hire", text: "Median days from creating a project to creating its contract, for accepted contracts created in the window." },
  { term: "Committed", text: "Total price of accepted contracts created in the window. Offers waiting for acceptance and cancelled contracts are not included." },
  { term: "Paid", text: "Milestone amounts you paid in the window, before fees, not refunded. A refund still in progress counts as paid until it completes." },
  { term: "Refunded", text: "Payments refunded in the window, at what went back to you: the amount plus the fee." },
  { term: "Fees", text: "PAPple client fees on those payments." },
  { term: "Invitation to proposal", text: "Invitations sent in the window where the professional then sent a proposal to the same project after the invitation, and has not withdrawn it." },
  { term: "By month", text: "Calendar months in UTC; the first and the current month are partial. Shows the latest 13 months." },
  { term: "Currencies", text: "Amounts are never added across currencies; each currency has its own row." },
];

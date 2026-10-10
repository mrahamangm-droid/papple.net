import { formatMinor } from "../marketplace/present";
import type { BudgetStatus } from "./service";

const live = (s: BudgetStatus | null): s is BudgetStatus => !!s && s.enabled;

/** The usage line and bar for a budget that is on; null when there is none or it is off. */
export function budgetMeter(s: BudgetStatus | null): { text: string; percent: number; over: boolean; note: string | null } | null {
  if (!live(s)) return null;
  const over = s.remaining < 0;
  const other = s.other_currency === 1 ? "1 item in another currency is not counted." : s.other_currency > 1 ? `${s.other_currency} items in other currencies are not counted.` : null;
  return {
    text: `${formatMinor(s.spent, s.currency)} of ${formatMinor(s.limit, s.currency)} used this ${s.period}`,
    percent: Math.min(100, Math.max(0, Math.round((s.spent / s.limit) * 100))),
    over,
    note: over ? `Over budget by ${formatMinor(-s.remaining, s.currency)}.` : other,
  };
}

/** Shown next to Accept on a draft contract. Mirrors accept_contract: owners may go over, admins are sent to an owner. */
export function acceptBudgetWarning(s: BudgetStatus | null, price: number, currency: string, isOwner: boolean): string | null {
  if (!live(s)) return null;
  if (currency !== s.currency) return isOwner ? null : `This contract is in ${currency} and the budget is in ${s.currency}, so it will be sent to an owner for approval.`;
  if (price <= s.remaining) return null;
  const by = `Accepting this contract goes over the budget by ${formatMinor(price - Math.max(s.remaining, 0), s.currency)}`;
  return isOwner ? `${by}.` : `${by}, so it will be sent to an owner for approval.`;
}

/** Next to Approve: reasons are fixed when a request is made, so the budget may have filled up since. Approval never re-checks. */
export function approveBudgetWarning(s: BudgetStatus | null, price: number, currency: string): string | null {
  if (!live(s)) return null;
  if (currency !== s.currency) return `This contract is in ${currency}, so it is not counted against the ${s.currency} budget.`;
  return price <= s.remaining ? null : `Approving this goes over the budget by ${formatMinor(price - Math.max(s.remaining, 0), s.currency)}.`;
}

/** Paid bookings count but are never blocked; the client just hears about it first. */
export function bookingBudgetWarning(s: BudgetStatus | null, price: number, currency: string): string | null {
  if (!live(s) || currency !== s.currency || price <= s.remaining) return null;
  return `Paying this booking goes over your organization's budget by ${formatMinor(price - Math.max(s.remaining, 0), s.currency)}.`;
}

const REASONS: Record<string, string> = { threshold: "Above the approval threshold", budget: "Over budget" };
export const requestReasonLabels = (reasons: string[]): string[] => reasons.map((r) => REASONS[r]).filter((x): x is string => !!x);

export interface BudgetSetting { enabled: boolean; period: string; amount_minor: number; currency: string }
export function budgetSummary(b: BudgetSetting | null): string {
  if (!b || !b.enabled) return "No budget. Spending is not limited by period.";
  return `Budget: ${formatMinor(b.amount_minor, b.currency)} per ${b.period}. An admin accepting a contract that goes over it, or one in another currency, needs an owner's approval.`;
}

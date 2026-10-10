import { z } from "zod";
import { minorExponent, toMinor } from "../marketplace/present";
import type { ApprovalFailure } from "../approvals/present";

export type DoneResult = { ok: true } | { ok: false; code: ApprovalFailure };

export interface BudgetsDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may set or read the budget. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const MAX_MINOR = 2147483647;
const saveInput = z.object({
  orgId: z.string().uuid(),
  enabled: z.boolean(),
  period: z.enum(["month", "quarter"]),
  // plain digits with an optional decimal part: no signs, separators or exponents
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});

const statusSchema = z.object({
  enabled: z.boolean(), period: z.enum(["month", "quarter"]), period_start: z.string(), period_end: z.string(), currency: z.string(),
  limit: z.number().int(), spent: z.number().int(), remaining: z.number().int(), contracts: z.number().int(), bookings: z.number().int(),
  other_currency: z.number().int(),
});
export type BudgetStatus = z.infer<typeof statusSchema>;

/** budget_status's jsonb, or null for no budget. Anything malformed also reads as no budget, so a page never shows wrong numbers. */
export function parseStatus(raw: unknown): BudgetStatus | null {
  const p = statusSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** Major-unit text -> minor units, or null when it has more decimals than the currency or is outside 1..MAX. Never rounds. */
function budgetMinor(amount: string, currency: string): number | null {
  if ((amount.split(".")[1]?.length ?? 0) > minorExponent(currency)) return null;
  const minor = toMinor(Number(amount), currency);
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= MAX_MINOR ? minor : null;
}

const failure = (code?: string): ApprovalFailure => (code === "42501" ? "forbidden" : code === "22023" ? "invalid" : "error");

export function createBudgetsService(deps: BudgetsDeps) {
  return {
    async save(raw: unknown): Promise<DoneResult> {
      const p = saveInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const amount = budgetMinor(p.data.amount, p.data.currency);
      if (amount === null) return { ok: false, code: "invalid" };
      try {
        const userId = await deps.getUserId();
        if (!userId) return { ok: false, code: "forbidden" };
        if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
        const { error } = await deps.rpc("budget_set", { p_org: p.data.orgId, p_enabled: p.data.enabled, p_period: p.data.period, p_amount: amount, p_currency: p.data.currency });
        if (error) return { ok: false, code: failure(error.code) };
      } catch {
        return { ok: false, code: "error" };
      }
      deps.revalidate("/settings/approvals");
      deps.revalidate("/approvals");
      return { ok: true };
    },
  };
}

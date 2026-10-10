import { z } from "zod";
import { minorExponent, toMinor } from "../marketplace/present";
import type { ApprovalFailure, DecideOutcome } from "./present";

export type { ApprovalFailure, DecideOutcome };
export type DoneResult = { ok: true } | { ok: false; code: ApprovalFailure };
export type DecideResult = { ok: true; outcome: DecideOutcome } | { ok: false; code: ApprovalFailure };

export interface ApprovalsDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const MAX_MINOR = 2147483647;
const id = z.string().uuid();
const policyInput = z.object({
  orgId: id,
  enabled: z.boolean(),
  // plain digits with an optional decimal part: no signs, separators or exponents
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});
const decideInput = z.object({ orgId: id, requestId: id, contractId: id.optional(), approve: z.boolean(), note: z.string().max(500) })
  .refine((v) => v.approve || v.note.trim().length > 0);
const withdrawInput = z.object({ orgId: id, requestId: id, contractId: id.optional() });
const OUTCOMES: readonly DecideOutcome[] = ["approved", "partial", "rejected", "lapsed"];
const tiersInput = z.object({
  orgId: id,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  tiers: z.array(z.object({ min: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/), approvals: z.number().int().min(1).max(3) })).max(10),
});

const failure = (code?: string): ApprovalFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "23505" ? "duplicate" : code === "55000" ? "stale" : "error";

/** Major-unit text -> minor units, or null when it has more decimals than the currency or exceeds the database range. */
function thresholdMinor(amount: string, currency: string): number | null {
  const decimals = amount.split(".")[1]?.length ?? 0;
  if (decimals > minorExponent(currency)) return null;
  const minor = toMinor(Number(amount), currency);
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : null;
}

export function createApprovalsService(deps: ApprovalsDeps) {
  async function run(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: ApprovalFailure }> {
    try {
      const userId = await deps.getUserId();
      if (!userId) return { ok: false, code: "forbidden" };
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
      const { data, error } = await deps.rpc(fn, args);
      return error ? { ok: false, code: failure(error.code) } : { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }
  const refresh = (contractId?: string) => {
    deps.revalidate("/approvals");
    if (contractId) deps.revalidate(`/contracts/${contractId}`);
  };

  return {
    async setPolicy(raw: unknown): Promise<DoneResult> {
      const p = policyInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const threshold = thresholdMinor(p.data.amount, p.data.currency);
      if (threshold === null) return { ok: false, code: "invalid" };
      const r = await run("spend_policy_set", { p_org: p.data.orgId, p_enabled: p.data.enabled, p_threshold: threshold, p_currency: p.data.currency });
      if (!r.ok) return r;
      deps.revalidate("/settings/approvals");
      return { ok: true };
    },
    /** Replaces the organization's tiers. Amounts are typed in major units of the rule's currency and never rounded. */
    async setTiers(raw: unknown): Promise<DoneResult> {
      const p = tiersInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const rows: { min: number; approvals: number }[] = [];
      for (const t of p.data.tiers) {
        const min = thresholdMinor(t.min, p.data.currency);
        if (min === null || rows.some((r) => r.min === min)) return { ok: false, code: "invalid" };
        rows.push({ min, approvals: t.approvals });
      }
      const r = await run("spend_tiers_set", { p_org: p.data.orgId, p_tiers: rows });
      if (!r.ok) return r;
      deps.revalidate("/settings/approvals");
      return { ok: true };
    },
    async decide(raw: unknown): Promise<DecideResult> {
      const p = decideInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const r = await run("spend_request_decide", { p_org: p.data.orgId, p_request: p.data.requestId, p_approve: p.data.approve, p_note: p.data.note.trim() });
      if (!r.ok) return r;
      if (!OUTCOMES.includes(r.data as DecideOutcome)) return { ok: false, code: "error" };
      refresh(p.data.contractId);
      return { ok: true, outcome: r.data as DecideOutcome };
    },
    async withdraw(raw: unknown): Promise<DoneResult> {
      const p = withdrawInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const r = await run("spend_request_withdraw", { p_org: p.data.orgId, p_request: p.data.requestId });
      if (!r.ok) return r;
      refresh(p.data.contractId);
      return { ok: true };
    },
  };
}

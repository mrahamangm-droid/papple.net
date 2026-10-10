import { describe, expect, it, vi } from "vitest";
import { createBudgetsService, type BudgetsDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const STATUS = {
  enabled: true, period: "quarter", period_start: "2026-10-01T00:00:00+00:00", period_end: "2027-01-01T00:00:00+00:00",
  currency: "USD", limit: 1000000, spent: 620000, remaining: 380000, contracts: 600000, bookings: 20000, other_currency: 1,
};
type RpcImpl = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
function mk(rpcImpl?: RpcImpl, over: Partial<BudgetsDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: null, error: null })));
  const revalidate = vi.fn();
  const deps: BudgetsDeps = { getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, ...over };
  return { svc: createBudgetsService(deps), rpc, revalidate };
}
const save = (o: Record<string, unknown> = {}) => ({ orgId: ORG, enabled: true, period: "quarter", amount: "10000", currency: "usd", ...o });

describe("save", () => {
  it("turns the typed amount into minor units and refreshes the pages", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.save(save({ amount: "10000.50" }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("budget_set", { p_org: ORG, p_enabled: true, p_period: "quarter", p_amount: 1000050, p_currency: "USD" });
    expect(revalidate).toHaveBeenCalledWith("/settings/approvals");
    expect(revalidate).toHaveBeenCalledWith("/approvals");
  });
  it("uses the currency's own decimals", async () => {
    const { svc, rpc } = mk();
    await svc.save(save({ amount: "500000", currency: "JPY" }));
    expect(rpc).toHaveBeenLastCalledWith("budget_set", expect.objectContaining({ p_amount: 500000, p_currency: "JPY" }));
  });
  it.each(["", "0", "10.555", "-1", "1e5", "1,000", "abc", "21474836.48"])("refuses %j without rounding", async (amount) => {
    const { svc, rpc } = mk();
    expect(await svc.save(save({ amount }))).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses other periods", async () => {
    expect(await mk().svc.save(save({ period: "year" }))).toEqual({ ok: false, code: "invalid" });
  });
  it("needs a user, respects the rate limit and maps database refusals", async () => {
    expect(await mk(undefined, { getUserId: async () => null }).svc.save(save())).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(undefined, { throttle: async () => false }).svc.save(save())).toEqual({ ok: false, code: "rate" });
    expect(await mk(async () => ({ data: null, error: { code: "42501" } })).svc.save(save())).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(async () => ({ data: null, error: { code: "22023" } })).svc.save(save())).toEqual({ ok: false, code: "invalid" });
  });
});

describe("parseStatus", () => {
  it("accepts the database's answer and null", async () => {
    const { parseStatus } = await import("./service");
    expect(parseStatus(STATUS)).toEqual(STATUS);
    expect(parseStatus(null)).toBeNull();
  });
  it("treats anything malformed as no budget", async () => {
    const { parseStatus } = await import("./service");
    expect(parseStatus({ ...STATUS, spent: "620000" })).toBeNull();
    expect(parseStatus({ ...STATUS, period: "year" })).toBeNull();
  });
});

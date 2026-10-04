import { describe, expect, it, vi } from "vitest";
import { createAnalyticsService, type AnalyticsDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const good = {
  days: 30, requested_days: 30, capped: false, since: "2026-09-01T00:00:00Z",
  projects: { posted: 0, open: 0, closed: 0, cancelled: 0, other: 0 },
  proposals: { received: 0, shortlisted: 0, avg_per_project: null },
  hiring: { hired: 0, hire_rate_pct: null, median_days_to_hire: null },
  contracts: { draft: 0, active: 0, completed: 0, disputed: 0, cancelled: 0 },
  money: [], top_providers: [],
  talent: { pools: 0, pooled: 0, invites_sent: 0, invites_declined: 0, proposals_from_invited: 0, invite_to_proposal_pct: null },
  monthly: [],
};

function setup(over: Partial<AnalyticsDeps> = {}) {
  const rpc = vi.fn(async () => ({ data: good as unknown, error: null as { code?: string } | null }));
  const deps: AnalyticsDeps = { getUserId: async () => "u1", throttle: async () => true, rpc, ...over };
  return { svc: createAnalyticsService(deps), rpc };
}

describe("load", () => {
  it("returns parsed analytics for a valid request", async () => {
    const { svc, rpc } = setup();
    const r = await svc.load({ orgId: ORG, days: 90 });
    expect(r.ok && r.data.projects.posted).toBe(0);
    expect(rpc).toHaveBeenCalledWith("org_analytics", { p_org: ORG, p_days: 90 });
  });
  it("refuses an invalid window or org without calling the database", async () => {
    const { svc, rpc } = setup();
    expect(await svc.load({ orgId: ORG, days: 7 })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.load({ orgId: "nope", days: 30 })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is forbidden when signed out", async () => {
    const { svc, rpc } = setup({ getUserId: async () => null });
    expect(await svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is rate limited, and fails closed when the limiter breaks", async () => {
    expect(await setup({ throttle: async () => false }).svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: "rate" });
    expect(await setup({ throttle: async () => { throw new Error("down"); } }).svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: "error" });
  });
  it("maps database codes", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["XX000", "error"]] as const) {
      const { svc, rpc } = setup();
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: want });
    }
  });
  it("treats an unparseable response as an error", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { nonsense: true }, error: null });
    expect(await svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: "error" });
  });
  it("fails closed when the database call throws", async () => {
    const { svc, rpc } = setup();
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await svc.load({ orgId: ORG, days: 30 })).toEqual({ ok: false, code: "error" });
  });
});

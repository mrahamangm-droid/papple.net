import { z } from "zod";
import { parseAnalytics, WINDOWS, type Analytics, type AnalyticsFailure } from "./present";

export type { AnalyticsFailure };
export type LoadResult = { ok: true; data: Analytics } | { ok: false; code: AnalyticsFailure };

export interface AnalyticsDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may read. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
}

const input = z.object({ orgId: z.string().uuid(), days: z.number().refine((d) => (WINDOWS as readonly number[]).includes(d)) });
const failure = (code?: string): AnalyticsFailure => (code === "42501" ? "forbidden" : code === "22023" ? "invalid" : "error");

export function createAnalyticsService(deps: AnalyticsDeps) {
  return {
    async load(raw: unknown): Promise<LoadResult> {
      const p = input.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const userId = await deps.getUserId();
      if (!userId) return { ok: false, code: "forbidden" };
      try {
        if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
      } catch {
        return { ok: false, code: "error" };
      }
      try {
        const { data, error } = await deps.rpc("org_analytics", { p_org: p.data.orgId, p_days: p.data.days });
        if (error) return { ok: false, code: failure(error.code) };
        const parsed = parseAnalytics(data);
        return parsed ? { ok: true, data: parsed } : { ok: false, code: "error" };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}

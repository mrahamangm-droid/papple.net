import { z } from "zod";
import { decodeCursor, encodeCursor } from "./cursor";
import { bearerSecret, hashApiKey } from "./keys";

export type Resource = "projects" | "proposals" | "contracts" | "analytics";
export interface ApiV1Deps {
  /** Resolves a key hash to its organization id, or null (service role only). */
  authenticate: (hash: string) => Promise<string | null>;
  /** True when the call may proceed. "ip" buckets the caller's address (before any key is looked at); "key" buckets a key hash. */
  throttle: (kind: "ip" | "key", key: string) => Promise<boolean>;
  /** Called as the service role; every call carries the organization the key resolved to. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...JSON_HEADERS, ...extra } });
const bad = (error: string) => json({ error }, 400);
const WINDOW_SEC = "60";

const intParam = (v: string | null, def: number, min: number, max: number): number | null => {
  if (v === null) return def;
  if (!/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};
const page = z.object({ data: z.array(z.unknown()), next: z.object({ ts: z.string(), id: z.string() }).nullable() });
const FN = { projects: "api_v1_projects", proposals: "api_v1_proposals", contracts: "api_v1_contracts" } as const;

export function createApiV1(deps: ApiV1Deps) {
  return {
    async handle(resource: Resource, req: Request): Promise<Response> {
      const unauthorized = () => json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
      const limited = () => json({ error: "rate_limited" }, 429, { "retry-after": WINDOW_SEC });
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const secret = bearerSecret(req.headers.get("authorization"));
      let org: string | null;
      try {
        // Address first, then key, both before the database: guessed keys and floods never cost a lookup.
        if (!(await deps.throttle("ip", ip))) return limited();
        if (!secret) return unauthorized();
        const hash = hashApiKey(secret);
        if (!(await deps.throttle("key", hash.slice(0, 32)))) return limited();
        org = await deps.authenticate(hash);
        if (!org) return unauthorized();
      } catch {
        return json({ error: "server_error" }, 500);
      }

      const q = new URL(req.url).searchParams;
      for (const k of ["limit", "after", "project_id", "days"]) if (q.getAll(k).length > 1) return bad("duplicate_parameter");

      try {
        if (resource === "analytics") {
          const days = intParam(q.get("days"), 365, 1, 3650);
          if (days === null) return bad("invalid_days");
          const { data, error } = await deps.rpc("org_analytics_compute", { p_org: org, p_days: days });
          if (error || data === null || typeof data !== "object") return json({ error: "server_error" }, 500);
          return json(data);
        }
        const limit = intParam(q.get("limit"), 50, 1, 100);
        if (limit === null) return bad("invalid_limit");
        const rawAfter = q.get("after");
        const after = rawAfter === null ? null : decodeCursor(rawAfter);
        if (rawAfter !== null && !after) return bad("invalid_cursor");
        const args: Record<string, unknown> = { p_org: org, p_limit: limit, p_after_ts: after?.ts ?? null, p_after_id: after?.id ?? null };
        if (resource === "proposals") {
          const pid = q.get("project_id");
          if (pid !== null && !z.string().uuid().safeParse(pid).success) return bad("invalid_project_id");
          args.p_project = pid;
        }
        const { data, error } = await deps.rpc(FN[resource], args);
        const parsed = error ? null : page.safeParse(data);
        if (!parsed?.success) return json({ error: "server_error" }, 500);
        return json({ data: parsed.data.data, next: parsed.data.next ? encodeCursor(parsed.data.next) : null });
      } catch {
        return json({ error: "server_error" }, 500);
      }
    },
  };
}

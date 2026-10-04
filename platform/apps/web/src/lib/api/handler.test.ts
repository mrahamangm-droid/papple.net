import { describe, expect, it, vi } from "vitest";
import { encodeCursor } from "./cursor";
import { createApiV1, type ApiV1Deps } from "./handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const SECRET = `pap_${"A".repeat(43)}`;
const req = (path: string, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) => new Request(`https://papple.test/api/v1/${path}`, { headers });

function setup(over: Partial<ApiV1Deps> = {}) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { data: [{ id: "x" }], next: null } as unknown, error: null as { code?: string } | null }));
  const authenticate = vi.fn(async (_hash: string) => ORG as string | null);
  const throttle = vi.fn(async (_kind: "ip" | "key", _key: string) => true);
  const api = createApiV1({ authenticate, throttle, rpc, ...over });
  return { api, rpc, authenticate, throttle };
}

describe("authentication", () => {
  it("answers 401 with one body for missing, malformed, unknown and revoked keys", async () => {
    const bodies = new Set<string>();
    for (const r of [req("projects", {}), req("projects", { authorization: "Bearer nope" }), req("projects")]) {
      const { api } = setup({ authenticate: async () => null });
      const res = await api.handle("projects", r);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });
  it("does not touch the database for a malformed header", async () => {
    const { api, authenticate } = setup();
    await api.handle("projects", req("projects", { authorization: "Bearer nope" }));
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("passes only the hash of the key, never the secret", async () => {
    const { api, authenticate } = setup();
    await api.handle("projects", req("projects"));
    expect(authenticate.mock.calls[0]![0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(authenticate.mock.calls)).not.toContain(SECRET);
  });
  it("is a generic 500 when authentication itself fails", async () => {
    const { api } = setup({ authenticate: async () => { throw new Error("boom: secret detail"); } });
    const res = await api.handle("projects", req("projects"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("boom");
  });
});

describe("rate limit", () => {
  it("answers 429 with Retry-After and does not authenticate or read data when the key is over its limit", async () => {
    const { api, rpc, authenticate } = setup({ throttle: async (kind) => kind !== "key" });
    const res = await api.handle("projects", req("projects"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(authenticate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("throttles the caller's address before anything else, even with no key at all", async () => {
    const { api, authenticate } = setup({ throttle: async (kind) => kind !== "ip" });
    const res = await api.handle("projects", req("projects", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(res.status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("keys the address bucket on the first forwarded address, or a shared bucket when there is none", async () => {
    const a = setup();
    await a.api.handle("projects", req("projects", { authorization: `Bearer ${SECRET}`, "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(a.throttle).toHaveBeenCalledWith("ip", "203.0.113.9");
    const b = setup();
    await b.api.handle("projects", req("projects"));
    expect(b.throttle).toHaveBeenCalledWith("ip", "unknown");
  });
  it("keys the key bucket on the hash of the key and fails closed when the limiter breaks", async () => {
    const { api, throttle } = setup();
    await api.handle("projects", req("projects"));
    const call = throttle.mock.calls.find((c) => c[0] === "key")!;
    expect(call[1]).toMatch(/^[0-9a-f]{16,64}$/);
    const broken = setup({ throttle: async () => { throw new Error("down"); } });
    expect((await broken.api.handle("projects", req("projects"))).status).toBe(500);
  });
});

describe("lists", () => {
  it("scopes the read to the organization the key resolved to", async () => {
    const { api, rpc } = setup();
    await api.handle("projects", req("projects?limit=10"));
    expect(rpc).toHaveBeenCalledWith("api_v1_projects", { p_org: ORG, p_limit: 10, p_after_ts: null, p_after_id: null });
  });
  it("defaults the limit to 50", async () => {
    const { api, rpc } = setup();
    await api.handle("contracts", req("contracts"));
    expect(rpc).toHaveBeenCalledWith("api_v1_contracts", { p_org: ORG, p_limit: 50, p_after_ts: null, p_after_id: null });
  });
  it("rejects a bad limit with 400 and does not read", async () => {
    for (const q of ["limit=0", "limit=101", "limit=abc", "limit=1.5", "limit=-1", "limit=10&limit=20"]) {
      const { api, rpc } = setup();
      const res = await api.handle("projects", req(`projects?${q}`));
      expect(res.status, q).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("turns a cursor into the keyset arguments and a database cursor back into an opaque one", async () => {
    const cur = { ts: "2026-10-02T10:00:00.123456+00:00", id: "22222222-2222-4222-8222-222222222222" };
    const { api, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { data: [], next: cur }, error: null });
    const res = await api.handle("projects", req(`projects?after=${encodeCursor(cur)}`));
    expect(rpc).toHaveBeenCalledWith("api_v1_projects", { p_org: ORG, p_limit: 50, p_after_ts: cur.ts, p_after_id: cur.id });
    expect(await res.json()).toEqual({ data: [], next: encodeCursor(cur) });
  });
  it("rejects a malformed cursor with 400", async () => {
    const { api, rpc } = setup();
    expect((await api.handle("projects", req("projects?after=garbage"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns next as null on the last page and sends no-store", async () => {
    const { api } = setup();
    const res = await api.handle("projects", req("projects"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ data: [{ id: "x" }], next: null });
  });
  it("filters proposals by project id, and rejects a bad one", async () => {
    const pid = "33333333-3333-4333-8333-333333333333";
    const { api, rpc } = setup();
    await api.handle("proposals", req(`proposals?project_id=${pid}`));
    expect(rpc).toHaveBeenCalledWith("api_v1_proposals", { p_org: ORG, p_limit: 50, p_after_ts: null, p_after_id: null, p_project: pid });
    expect((await setup().api.handle("proposals", req("proposals?project_id=nope"))).status).toBe(400);
  });
  it("hides database errors behind a generic 500", async () => {
    const { api, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const res = await api.handle("projects", req("projects"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
  it("treats a malformed database answer as a 500", async () => {
    const { api, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect((await api.handle("projects", req("projects"))).status).toBe(500);
  });
});

describe("analytics", () => {
  it("defaults to 365 days (the plan caps it) and returns the database object", async () => {
    const { api, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { days: 30, capped: true }, error: null });
    const res = await api.handle("analytics", req("analytics"));
    expect(rpc).toHaveBeenCalledWith("org_analytics_compute", { p_org: ORG, p_days: 365 });
    expect(await res.json()).toEqual({ days: 30, capped: true });
  });
  it("validates days as an integer from 1 to 3650", async () => {
    for (const q of ["days=0", "days=3651", "days=x", "days=1.5"]) {
      const { api, rpc } = setup();
      expect((await api.handle("analytics", req(`analytics?${q}`))).status, q).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
    const ok = setup();
    ok.rpc.mockResolvedValueOnce({ data: { days: 90 }, error: null });
    expect((await ok.api.handle("analytics", req("analytics?days=90"))).status).toBe(200);
  });
});

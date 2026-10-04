import { describe, expect, it, vi } from "vitest";
import { createApiKeyService, type ApiKeyDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const KEY = { secret: `pap_${"A".repeat(43)}`, prefix: "AAAAAAAA", hash: "a".repeat(64) };

function setup(over: Partial<ApiKeyDeps> = {}) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: "key-id" as unknown, error: null as { code?: string } | null }));
  const revalidate = vi.fn();
  const deps: ApiKeyDeps = { getUserId: async () => "u1", throttle: async () => true, rpc, revalidate, generate: () => KEY, ...over };
  return { svc: createApiKeyService(deps), rpc, revalidate };
}

describe("create", () => {
  it("sends only the hash and prefix to the database and returns the secret once", async () => {
    const { svc, rpc, revalidate } = setup();
    const r = await svc.create({ orgId: ORG, name: "  Reporting  " });
    expect(r).toEqual({ ok: true, id: "key-id", secret: KEY.secret, prefix: KEY.prefix });
    expect(rpc).toHaveBeenCalledWith("api_key_create", { p_org: ORG, p_name: "Reporting", p_prefix: KEY.prefix, p_hash: KEY.hash });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(KEY.secret);
    expect(revalidate).toHaveBeenCalledWith("/settings/api-keys");
  });
  it("validates the input without calling the database", async () => {
    const { svc, rpc } = setup();
    for (const bad of [{ orgId: "x", name: "ok" }, { orgId: ORG, name: "   " }, { orgId: ORG, name: "n".repeat(61) }, { orgId: ORG }, null]) {
      expect(await svc.create(bad)).toEqual({ ok: false, code: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is forbidden when signed out, rate limited, and fails closed when the limiter breaks", async () => {
    expect(await setup({ getUserId: async () => null }).svc.create({ orgId: ORG, name: "a" })).toEqual({ ok: false, code: "forbidden" });
    expect(await setup({ throttle: async () => false }).svc.create({ orgId: ORG, name: "a" })).toEqual({ ok: false, code: "rate" });
    expect(await setup({ throttle: async () => { throw new Error("x"); } }).svc.create({ orgId: ORG, name: "a" })).toEqual({ ok: false, code: "error" });
  });
  it("maps database codes and never returns a secret on failure", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["54000", "limit"], ["23505", "error"], ["XX000", "error"]] as const) {
      const { svc, rpc, revalidate } = setup();
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      const r = await svc.create({ orgId: ORG, name: "a" });
      expect(r).toEqual({ ok: false, code: want });
      expect(revalidate).not.toHaveBeenCalled();
    }
  });
  it("does not report success when the database returns no id", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await svc.create({ orgId: ORG, name: "a" })).toEqual({ ok: false, code: "error" });
  });
  it("turns a thrown database error into a failure", async () => {
    const { svc, rpc } = setup();
    rpc.mockRejectedValueOnce(new Error("down"));
    expect(await svc.create({ orgId: ORG, name: "a" })).toEqual({ ok: false, code: "error" });
  });
});

describe("revoke", () => {
  const ID = "22222222-2222-4222-8222-222222222222";
  it("revokes and refreshes the page", async () => {
    const { svc, rpc, revalidate } = setup();
    expect(await svc.revoke({ orgId: ORG, id: ID })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("api_key_revoke", { p_org: ORG, p_id: ID });
    expect(revalidate).toHaveBeenCalledWith("/settings/api-keys");
  });
  it("validates ids, maps errors", async () => {
    const { svc, rpc } = setup();
    expect(await svc.revoke({ orgId: ORG, id: "x" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await svc.revoke({ orgId: ORG, id: ID })).toEqual({ ok: false, code: "forbidden" });
  });
});

describe("list", () => {
  it("is not counted against the action limit, so page views and refreshes never hide the key list", async () => {
    const throttle = vi.fn(async () => false);
    const { svc, rpc } = setup({ throttle });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await svc.list(ORG)).toEqual({ ok: true, keys: [] });
    expect(throttle).not.toHaveBeenCalled();
  });
  it("is forbidden when signed out", async () => {
    expect(await setup({ getUserId: async () => null }).svc.list(ORG)).toEqual({ ok: false, code: "forbidden" });
  });
  it("returns parsed keys and drops rows that are not keys", async () => {
    const row = { id: "k1", name: "Reporting", prefix: "AAAAAAAA", created_at: "2026-10-01T00:00:00Z", last_used_at: null, revoked_at: null, created_by_name: "Owner One", creator_active: true };
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: [row, { nope: 1 }], error: null });
    const r = await svc.list(ORG);
    expect(rpc).toHaveBeenCalledWith("api_keys_list", { p_org: ORG });
    expect(r).toEqual({ ok: true, keys: [{ id: "k1", name: "Reporting", prefix: "AAAAAAAA", createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null, revokedAt: null, createdByName: "Owner One", creatorActive: true }] });
  });
  it("is forbidden for non-owners and invalid for a bad org id", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await svc.list(ORG)).toEqual({ ok: false, code: "forbidden" });
    expect(await svc.list("x")).toEqual({ ok: false, code: "invalid" });
  });
});

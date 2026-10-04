import { describe, expect, it, vi } from "vitest";
import { createTalentService, type TalentDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const POOL = "22222222-2222-4222-8222-222222222222";
const PROF = "33333333-3333-4333-8333-333333333333";
const PROJ = "44444444-4444-4444-8444-444444444444";
const INV = "55555555-5555-4555-8555-555555555555";

function setup(over: Partial<TalentDeps> = {}) {
  const rpc = vi.fn(async () => ({ data: null as unknown, error: null as { code?: string } | null }));
  const revalidate = vi.fn();
  const deps: TalentDeps = { getUserId: async () => "u1", throttle: async () => true, rpc, revalidate, ...over };
  return { svc: createTalentService(deps), rpc, revalidate };
}

describe("savePool", () => {
  it("creates a pool and returns its id", async () => {
    const { svc, rpc, revalidate } = setup();
    rpc.mockResolvedValueOnce({ data: POOL, error: null });
    expect(await svc.savePool({ orgId: ORG, name: "  Shortlist ", description: "" })).toEqual({ ok: true, id: POOL });
    expect(rpc).toHaveBeenCalledWith("pool_save", { p_org: ORG, p_id: null, p_name: "Shortlist", p_description: "" });
    expect(revalidate).toHaveBeenCalledWith("/talent");
  });
  it("refuses a one-character name without calling the database", async () => {
    const { svc, rpc } = setup();
    expect(await svc.savePool({ orgId: ORG, name: "x", description: "" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a missing org id", async () => {
    const { svc } = setup();
    expect(await svc.savePool({ name: "Shortlist" })).toEqual({ ok: false, code: "invalid" });
  });
  it("maps database codes", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["54000", "limit"], ["23505", "duplicate"], ["XX000", "error"]] as const) {
      const { svc, rpc } = setup();
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await svc.savePool({ orgId: ORG, name: "Shortlist", description: "" })).toEqual({ ok: false, code: want });
    }
  });
  it("treats an unexpected data shape as an error", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { not: "a string" }, error: null });
    expect(await svc.savePool({ orgId: ORG, name: "Shortlist", description: "" })).toEqual({ ok: false, code: "error" });
  });
});

describe("gate", () => {
  it("is forbidden when signed out", async () => {
    const { svc, rpc } = setup({ getUserId: async () => null });
    expect(await svc.deletePool({ orgId: ORG, id: POOL })).toEqual({ ok: false, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is rate-limited when throttled", async () => {
    const { svc, rpc } = setup({ throttle: async () => false });
    expect(await svc.deletePool({ orgId: ORG, id: POOL })).toEqual({ ok: false, code: "rate" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed when the limiter breaks", async () => {
    const { svc } = setup({ throttle: async () => { throw new Error("redis down"); } });
    expect(await svc.deletePool({ orgId: ORG, id: POOL })).toEqual({ ok: false, code: "error" });
  });
  it("fails closed when the database call throws", async () => {
    const { svc, rpc } = setup();
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await svc.deletePool({ orgId: ORG, id: POOL })).toEqual({ ok: false, code: "error" });
  });
});

describe("members", () => {
  it("adds with normalised tags and a trimmed note", async () => {
    const { svc, rpc } = setup();
    expect(await svc.setMember({ orgId: ORG, poolId: POOL, profileId: PROF, note: "  good  ", tags: ["rust", "go"] })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("pool_set_member", { p_org: ORG, p_pool: POOL, p_profile: PROF, p_note: "good", p_tags: ["rust", "go"] });
  });
  it("sends a blank note as null", async () => {
    const { svc, rpc } = setup();
    await svc.setMember({ orgId: ORG, poolId: POOL, profileId: PROF, note: "   ", tags: [] });
    expect(rpc).toHaveBeenCalledWith("pool_set_member", expect.objectContaining({ p_note: null }));
  });
  it("refuses more than ten tags, an over-long tag and an over-long note", async () => {
    const { svc, rpc } = setup();
    const base = { orgId: ORG, poolId: POOL, profileId: PROF, note: "", tags: [] as string[] };
    expect(await svc.setMember({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.setMember({ ...base, tags: ["x".repeat(31)] })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.setMember({ ...base, note: "n".repeat(1001) })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("removes a member and refreshes the pool page", async () => {
    const { svc, rpc, revalidate } = setup();
    expect(await svc.removeMember({ orgId: ORG, poolId: POOL, profileId: PROF })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("pool_remove_member", { p_org: ORG, p_pool: POOL, p_profile: PROF });
    expect(revalidate).toHaveBeenCalledWith("/talent");
  });
});

describe("invitations", () => {
  it("invites with a trimmed message", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: INV, error: null });
    expect(await svc.invite({ orgId: ORG, projectId: PROJ, profileId: PROF, message: "  We would love your help  " })).toEqual({ ok: true, id: INV });
    expect(rpc).toHaveBeenCalledWith("project_invite", { p_org: ORG, p_project: PROJ, p_profile: PROF, p_message: "We would love your help" });
  });
  it("refuses a short message locally", async () => {
    const { svc, rpc } = setup();
    expect(await svc.invite({ orgId: ORG, projectId: PROJ, profileId: PROF, message: "hi" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports a repeat invitation as a duplicate", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    expect(await svc.invite({ orgId: ORG, projectId: PROJ, profileId: PROF, message: "We would love your help" })).toEqual({ ok: false, code: "duplicate" });
  });
  it("declines and refreshes the inbox", async () => {
    const { svc, rpc, revalidate } = setup();
    expect(await svc.decline({ orgId: ORG, id: INV })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("invitation_decline", { p_org: ORG, p_id: INV });
    expect(revalidate).toHaveBeenCalledWith("/invitations");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createTeamService, type TeamDeps } from "./service";
import { hashInviteToken } from "./token";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";
const TOKEN = "a".repeat(43);

function mk(rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>, over: Partial<TeamDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: INV, error: null })));
  const revalidate = vi.fn();
  const emailInvite = vi.fn(async () => "off" as const);
  const deps: TeamDeps = {
    getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, emailInvite: emailInvite as never,
    siteUrl: () => "https://papple.net", newToken: () => ({ token: TOKEN, hash: "h".repeat(64) }), ...over,
  };
  return { svc: createTeamService(deps), rpc, revalidate, emailInvite };
}

describe("invite", () => {
  it("creates the invite with the hash only and returns the one-time link", async () => {
    const { svc, rpc, revalidate } = mk();
    const r = await svc.invite({ orgId: ORG, email: "  Sara@X.test ", role: "member" });
    expect(r).toEqual({ ok: true, link: `https://papple.net/invite/${TOKEN}`, email: "off" });
    expect(rpc).toHaveBeenCalledWith("team_create_invite", { p_org: ORG, p_email: "sara@x.test", p_role: "member", p_token_hash: "h".repeat(64) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    expect(revalidate).toHaveBeenCalledWith("/settings/team");
  });
  it("rejects owner as a role, bad addresses and bad ids before any call", async () => {
    const { svc, rpc } = mk();
    expect(await svc.invite({ orgId: ORG, email: "a@b.test", role: "owner" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.invite({ orgId: ORG, email: "nope", role: "member" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.invite({ orgId: "x", email: "a@b.test", role: "member" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("needs a signed-in user and fails closed on a broken or tripped limiter", async () => {
    expect(await mk(undefined, { getUserId: async () => null }).svc.invite({ orgId: ORG, email: "a@b.test", role: "member" })).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(undefined, { throttle: async () => false }).svc.invite({ orgId: ORG, email: "a@b.test", role: "member" })).toEqual({ ok: false, code: "rate" });
    expect(await mk(undefined, { throttle: async () => { throw new Error("down"); } }).svc.invite({ orgId: ORG, email: "a@b.test", role: "member" })).toEqual({ ok: false, code: "error" });
  });
  it("maps database codes and never sends email when the invite was refused", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["23505", "duplicate"], ["54000", "limit"], ["55000", "notready"], ["XX000", "error"]] as const) {
      const { svc, emailInvite } = mk(async () => ({ data: null, error: { code } }));
      expect(await svc.invite({ orgId: ORG, email: "a@b.test", role: "member" })).toEqual({ ok: false, code: want });
      expect(emailInvite).not.toHaveBeenCalled();
    }
  });
  it("sends the email after the invite exists and reports how it went; a mail failure never loses the link", async () => {
    const mail = vi.fn(async () => "sent" as const);
    const sent = mk(undefined, { emailInvite: mail });
    expect(await sent.svc.invite({ orgId: ORG, email: "a@b.test", role: "viewer" })).toMatchObject({ ok: true, email: "sent" });
    expect(sent.rpc.mock.invocationCallOrder[0]!).toBeLessThan(mail.mock.invocationCallOrder[0]!);
    const broken = mk(undefined, { emailInvite: vi.fn(async () => { throw new Error("smtp"); }) });
    expect(await broken.svc.invite({ orgId: ORG, email: "a@b.test", role: "viewer" })).toEqual({ ok: true, link: `https://papple.net/invite/${TOKEN}`, email: "failed" });
  });
  it("passes the invite details to the mailer, link included", async () => {
    const emailInvite = vi.fn(async () => "sent" as const);
    const { svc } = mk(undefined, { emailInvite });
    await svc.invite({ orgId: ORG, email: "A@b.test", role: "viewer" });
    expect(emailInvite).toHaveBeenCalledWith({ orgId: ORG, userId: "u1", to: "a@b.test", role: "viewer", link: `https://papple.net/invite/${TOKEN}`, inviteId: INV });
  });
  it("does not hand out a link when the site URL is unknown", async () => {
    const { svc, rpc } = mk(undefined, { siteUrl: () => "" });
    expect(await svc.invite({ orgId: ORG, email: "a@b.test", role: "member" })).toEqual({ ok: false, code: "notready" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("members", () => {
  it("revokes, changes roles, removes and leaves through the database", async () => {
    const { svc, rpc, revalidate } = mk(async () => ({ data: null, error: null }));
    expect(await svc.revoke({ orgId: ORG, inviteId: INV })).toEqual({ ok: true });
    expect(await svc.setRole({ orgId: ORG, userId: USER, role: "admin" })).toEqual({ ok: true });
    expect(await svc.remove({ orgId: ORG, userId: USER })).toEqual({ ok: true });
    expect(await svc.leave({ orgId: ORG })).toEqual({ ok: true });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["team_revoke_invite", "team_set_role", "team_remove_member", "team_leave"]);
    expect(rpc).toHaveBeenCalledWith("team_set_role", { p_org: ORG, p_user: USER, p_role: "admin" });
    expect(revalidate).toHaveBeenCalledWith("/settings/team");
  });
  it("shows the last-owner rule as its own message", async () => {
    const { svc } = mk(async () => ({ data: null, error: { code: "P0001" } }));
    expect(await svc.leave({ orgId: ORG })).toEqual({ ok: false, code: "owner_required" });
    expect(await svc.setRole({ orgId: ORG, userId: USER, role: "member" })).toEqual({ ok: false, code: "owner_required" });
  });
  it("validates ids and roles", async () => {
    const { svc, rpc } = mk();
    expect(await svc.setRole({ orgId: ORG, userId: USER, role: "boss" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.remove({ orgId: ORG, userId: "x" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("accepting", () => {
  it("previews and accepts by hash, never sending the token itself", async () => {
    const preview = mk(async () => ({ data: { org_name: "Acme", role: "member", email: "a@b.test" }, error: null }));
    expect(await preview.svc.preview(TOKEN)).toEqual({ ok: true, orgName: "Acme", role: "member", email: "a@b.test" });
    const accept = mk(async () => ({ data: ORG, error: null }));
    expect(await accept.svc.accept(TOKEN)).toEqual({ ok: true, orgId: ORG });
    expect(JSON.stringify(accept.rpc.mock.calls)).not.toContain(TOKEN);
    expect(accept.rpc).toHaveBeenCalledWith("team_accept_invite", { p_token_hash: hashInviteToken(TOKEN) });
    expect(accept.revalidate).toHaveBeenCalledWith("/dashboard");
  });
  it("answers every bad token the same way without calling the database", async () => {
    const { svc, rpc } = mk();
    expect(await svc.accept("short")).toEqual({ ok: false, code: "forbidden" });
    expect(await svc.preview("")).toEqual({ ok: false, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a full organization to limit and anything else to forbidden or error", async () => {
    expect(await mk(async () => ({ data: null, error: { code: "54000" } })).svc.accept(TOKEN)).toEqual({ ok: false, code: "limit" });
    expect(await mk(async () => ({ data: null, error: { code: "42501" } })).svc.accept(TOKEN)).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(async () => ({ data: "not-a-uuid", error: null })).svc.accept(TOKEN)).toEqual({ ok: false, code: "error" });
  });
  it("is throttled like everything else", async () => {
    expect(await mk(undefined, { throttle: async () => false }).svc.accept(TOKEN)).toEqual({ ok: false, code: "rate" });
  });
});

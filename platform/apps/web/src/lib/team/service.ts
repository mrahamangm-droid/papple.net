import { z } from "zod";
import type { TeamFailure } from "./present";
import { hashInviteToken, isInviteToken } from "./token";

export type { TeamFailure };
export type DoneResult = { ok: true } | { ok: false; code: TeamFailure };
export type InviteResult = { ok: true; link: string; email: "sent" | "off" | "failed" } | { ok: false; code: TeamFailure };
export type PreviewResult = { ok: true; orgName: string; role: string; email: string } | { ok: false; code: TeamFailure };
export type AcceptResult = { ok: true; orgId: string } | { ok: false; code: TeamFailure };

export interface TeamDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
  /** Best effort and only after the invite exists. "off" when email invites are disabled or not configured. */
  emailInvite: (a: { orgId: string; userId: string; to: string; role: string; link: string; inviteId: string }) => Promise<"sent" | "off" | "failed">;
  siteUrl: () => string;
  newToken: () => { token: string; hash: string };
}

const id = z.string().uuid();
const inviteInput = z.object({
  orgId: id,
  email: z.string().trim().toLowerCase().max(254).regex(/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/),
  role: z.enum(["admin", "member", "viewer"]),
});
const revokeInput = z.object({ orgId: id, inviteId: id });
const roleInput = z.object({ orgId: id, userId: id, role: z.enum(["owner", "admin", "member", "viewer"]) });
const memberInput = z.object({ orgId: id, userId: id });
const orgInput = z.object({ orgId: id });
const preview = z.object({ org_name: z.string(), role: z.string(), email: z.string() });

const failure = (code?: string): TeamFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "23505" ? "duplicate" : code === "54000" ? "limit"
  : code === "55000" ? "notready" : code === "P0001" ? "owner_required" : "error";

export function createTeamService(deps: TeamDeps) {
  async function gate(): Promise<{ ok: true; userId: string } | { ok: false; code: TeamFailure }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true, userId };
  }
  async function call(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: TeamFailure }> {
    try {
      const { data, error } = await deps.rpc(fn, args);
      return error ? { ok: false, code: failure(error.code) } : { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }
  async function done(raw: unknown, schema: z.ZodType, fn: string, args: (v: never) => Record<string, unknown>): Promise<DoneResult> {
    const p = schema.safeParse(raw);
    if (!p.success) return { ok: false, code: "invalid" };
    const g = await gate();
    if (!g.ok) return g;
    const r = await call(fn, args(p.data as never));
    if (!r.ok) return r;
    deps.revalidate("/settings/team");
    return { ok: true };
  }

  return {
    async invite(raw: unknown): Promise<InviteResult> {
      const p = inviteInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      const site = deps.siteUrl();
      if (!site) return { ok: false, code: "notready" };
      const { token, hash } = deps.newToken();
      const r = await call("team_create_invite", { p_org: p.data.orgId, p_email: p.data.email, p_role: p.data.role, p_token_hash: hash });
      if (!r.ok) return r;
      if (typeof r.data !== "string") return { ok: false, code: "error" };
      deps.revalidate("/settings/team");
      const link = `${site}/invite/${token}`;
      let email: "sent" | "off" | "failed";
      try {
        email = await deps.emailInvite({ orgId: p.data.orgId, userId: g.userId, to: p.data.email, role: p.data.role, link, inviteId: r.data });
      } catch {
        email = "failed";
      }
      return { ok: true, link, email };
    },
    revoke: (raw: unknown) => done(raw, revokeInput, "team_revoke_invite", (v: z.infer<typeof revokeInput>) => ({ p_org: v.orgId, p_invite: v.inviteId })),
    setRole: (raw: unknown) => done(raw, roleInput, "team_set_role", (v: z.infer<typeof roleInput>) => ({ p_org: v.orgId, p_user: v.userId, p_role: v.role })),
    remove: (raw: unknown) => done(raw, memberInput, "team_remove_member", (v: z.infer<typeof memberInput>) => ({ p_org: v.orgId, p_user: v.userId })),
    leave: (raw: unknown) => done(raw, orgInput, "team_leave", (v: z.infer<typeof orgInput>) => ({ p_org: v.orgId })),

    async preview(token: string): Promise<PreviewResult> {
      if (!isInviteToken(token)) return { ok: false, code: "forbidden" };
      const g = await gate();
      if (!g.ok) return g;
      const r = await call("team_invite_preview", { p_token_hash: hashInviteToken(token) });
      if (!r.ok) return r;
      const p = preview.safeParse(r.data);
      return p.success ? { ok: true, orgName: p.data.org_name, role: p.data.role, email: p.data.email } : { ok: false, code: "error" };
    },
    async accept(token: string): Promise<AcceptResult> {
      if (!isInviteToken(token)) return { ok: false, code: "forbidden" };
      const g = await gate();
      if (!g.ok) return g;
      const r = await call("team_accept_invite", { p_token_hash: hashInviteToken(token) });
      if (!r.ok) return r;
      if (typeof r.data !== "string" || !id.safeParse(r.data).success) return { ok: false, code: "error" };
      deps.revalidate("/dashboard");
      deps.revalidate("/settings/team");
      return { ok: true, orgId: r.data };
    },
  };
}

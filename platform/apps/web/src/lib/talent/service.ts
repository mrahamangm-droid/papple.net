import { z } from "zod";
import type { TalentFailure } from "./present";

export type { TalentFailure };
export type IdResult = { ok: true; id: string } | { ok: false; code: TalentFailure };
export type DoneResult = { ok: true } | { ok: false; code: TalentFailure };

export interface TalentDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const id = z.string().uuid();
const poolInput = z.object({ orgId: id, id: id.optional(), name: z.string().trim().min(2).max(60), description: z.string().trim().max(300).optional() });
const poolRef = z.object({ orgId: id, id });
const memberInput = z.object({
  orgId: id, poolId: id, profileId: id,
  note: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10),
});
const memberRef = z.object({ orgId: id, poolId: id, profileId: id });
const inviteInput = z.object({ orgId: id, projectId: id, profileId: id, message: z.string().trim().min(10).max(1000) });

const failure = (code?: string): TalentFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "54000" ? "limit" : code === "23505" ? "duplicate" : "error";

export function createTalentService(deps: TalentDeps) {
  async function gate(): Promise<{ ok: true } | { ok: false; code: TalentFailure }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true };
  }
  async function call(fn: string, args: Record<string, unknown>, paths: string[]): Promise<{ ok: true; data: unknown } | { ok: false; code: TalentFailure }> {
    try {
      const { data, error } = await deps.rpc(fn, args);
      if (error) return { ok: false, code: failure(error.code) };
      for (const p of paths) deps.revalidate(p);
      return { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }
  async function run<S extends z.ZodType>(raw: unknown, schema: S, fn: string, args: (v: z.infer<S>) => Record<string, unknown>, paths: string[]) {
    const p = schema.safeParse(raw);
    if (!p.success) return { ok: false as const, code: "invalid" as TalentFailure };
    const g = await gate();
    if (!g.ok) return g;
    return call(fn, args(p.data), paths);
  }
  const toDone = (r: Awaited<ReturnType<typeof run>>): DoneResult => (r.ok ? { ok: true } : { ok: false, code: r.code });
  const toId = (r: Awaited<ReturnType<typeof run>>): IdResult =>
    !r.ok ? { ok: false, code: r.code } : typeof r.data === "string" ? { ok: true, id: r.data } : { ok: false, code: "error" };

  return {
    async savePool(raw: unknown): Promise<IdResult> {
      return toId(await run(raw, poolInput, "pool_save", (v) => ({ p_org: v.orgId, p_id: v.id ?? null, p_name: v.name, p_description: v.description ?? "" }), ["/talent"]));
    },
    async deletePool(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, poolRef, "pool_delete", (v) => ({ p_org: v.orgId, p_id: v.id }), ["/talent"]));
    },
    async setMember(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, memberInput, "pool_set_member", (v) => ({ p_org: v.orgId, p_pool: v.poolId, p_profile: v.profileId, p_note: v.note && v.note !== "" ? v.note : null, p_tags: v.tags }), ["/talent"]));
    },
    async removeMember(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, memberRef, "pool_remove_member", (v) => ({ p_org: v.orgId, p_pool: v.poolId, p_profile: v.profileId }), ["/talent"]));
    },
    async invite(raw: unknown): Promise<IdResult> {
      return toId(await run(raw, inviteInput, "project_invite", (v) => ({ p_org: v.orgId, p_project: v.projectId, p_profile: v.profileId, p_message: v.message }), ["/talent"]));
    },
    async decline(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, poolRef, "invitation_decline", (v) => ({ p_org: v.orgId, p_id: v.id }), ["/invitations"]));
    },
  };
}

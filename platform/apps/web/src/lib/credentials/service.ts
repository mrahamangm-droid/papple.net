import { z } from "zod";
import { KINDS, type CredentialFailure } from "./present";

export type { CredentialFailure };
export type IdResult = { ok: true; id: string } | { ok: false; code: CredentialFailure };
export type DoneResult = { ok: true } | { ok: false; code: CredentialFailure };

export interface CredentialDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional();
const blank = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const saveInput = z.object({
  orgId: id, id: id.optional(),
  kind: z.enum(KINDS),
  title: z.string().trim().min(3).max(160),
  issuer: z.string().trim().min(2).max(160),
  identifier: z.string().trim().max(80).optional(),
  issuedOn: date, expiresOn: date,
  evidenceUrl: z.string().trim().max(500).regex(/^https:\/\//).or(z.literal("")).optional(),
}).refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn);
const removeInput = z.object({ orgId: id, id });
const requestInput = z.object({ orgId: id, id, note: z.string().trim().min(10).max(1000) });

const failure = (code?: string): CredentialFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "54000" ? "limit" : "error";

export function createCredentialService(deps: CredentialDeps) {
  async function gate(): Promise<{ ok: true } | { ok: false; code: CredentialFailure }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true };
  }
  async function call(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: CredentialFailure }> {
    try {
      const { data, error } = await deps.rpc(fn, args);
      if (error) return { ok: false, code: failure(error.code) };
      deps.revalidate("/settings/credentials");
      return { ok: true, data };
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
    return r.ok ? { ok: true } : r;
  }
  return {
    async save(raw: unknown): Promise<IdResult> {
      const p = saveInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      const v = p.data;
      const r = await call("credential_save", {
        p_org: v.orgId, p_id: v.id ?? null, p_kind: v.kind, p_title: v.title, p_issuer: v.issuer, p_identifier: blank(v.identifier),
        p_issued: blank(v.issuedOn), p_expires: blank(v.expiresOn), p_evidence_url: blank(v.evidenceUrl),
      });
      if (!r.ok) return r;
      return typeof r.data === "string" ? { ok: true, id: r.data } : { ok: false, code: "error" };
    },
    remove: (raw: unknown) => done(raw, removeInput, "credential_delete", (v: z.infer<typeof removeInput>) => ({ p_org: v.orgId, p_id: v.id })),
    requestCheck: (raw: unknown) => done(raw, requestInput, "credential_request_check", (v: z.infer<typeof requestInput>) => ({ p_org: v.orgId, p_id: v.id, p_note: v.note })),
  };
}

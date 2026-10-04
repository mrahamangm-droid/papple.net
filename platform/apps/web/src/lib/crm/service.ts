import { z } from "zod";
import { parseContactsCsv } from "./csv";

export type CrmFailure = "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "error";
export type CsvFailure = "csv_empty" | "csv_too_big" | "csv_too_many_rows" | "csv_bad_format" | "csv_no_name_column";
export type IdResult = { ok: true; id: string } | { ok: false; code: CrmFailure };
export type DoneResult = { ok: true } | { ok: false; code: CrmFailure };
export type ImportReport = { imported: number; duplicate: number; invalidLines: number[]; limit: number };
export type ImportResult = { ok: true; report: ImportReport } | { ok: false; code: CrmFailure | CsvFailure };

export interface CrmDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may write. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const id = z.string().uuid();
const blank = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const contactInput = z.object({
  orgId: id, id: id.optional(),
  name: z.string().trim().min(1).max(160),
  company: z.string().max(160).optional(), phone: z.string().max(40).optional(),
  email: z.string().trim().max(254).refine((e) => e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).optional(),
  source: z.enum(["manual", "marketplace"]).default("manual"),
});
const dealInput = z.object({
  orgId: id, contactId: id, id: id.optional(),
  title: z.string().trim().min(1).max(200),
  stage: z.enum(["lead", "proposal", "won", "lost"]),
  value: z.number().int().min(0).max(2_000_000_000).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((v) => (v.value === undefined) === (v.currency === undefined));
const noteInput = z.object({ orgId: id, contactId: id, body: z.string().trim().min(1).max(4000), followUpAt: z.string().optional() });
const importInput = z.object({ orgId: id, csv: z.string(), attested: z.literal(true) });

const failure = (code?: string): CrmFailure =>
  code === "42501" ? "forbidden" : code === "54000" ? "limit" : code === "23505" ? "duplicate" : code === "22023" ? "invalid" : "error";

export function createCrmService(deps: CrmDeps) {
  /** Shared gate: signed in, then throttled. A broken limiter fails closed. */
  async function gate(): Promise<{ ok: false; code: CrmFailure } | { ok: true }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true };
  }

  async function call(fn: string, args: Record<string, unknown>, paths: string[]): Promise<{ ok: true; data: unknown } | { ok: false; code: CrmFailure }> {
    try {
      const { data, error } = await deps.rpc(fn, args);
      if (error) return { ok: false, code: failure(error.code) };
      paths.forEach((p) => deps.revalidate(p));
      return { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }

  async function idCall(raw: unknown, schema: z.ZodType, fn: string, args: (v: never) => Record<string, unknown>, paths: (v: never) => string[]): Promise<IdResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const g = await gate();
    if (!g.ok) return g;
    const r = await call(fn, args(parsed.data as never), paths(parsed.data as never));
    if (!r.ok) return r;
    return typeof r.data === "string" ? { ok: true, id: r.data } : { ok: false, code: "error" };
  }

  async function doneCall(raw: unknown, schema: z.ZodType, fn: string, args: (v: never) => Record<string, unknown>, paths: (v: never) => string[]): Promise<DoneResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const g = await gate();
    if (!g.ok) return g;
    const r = await call(fn, args(parsed.data as never), paths(parsed.data as never));
    return r.ok ? { ok: true } : r;
  }

  return {
    saveContact: (raw: unknown) =>
      idCall(raw, contactInput, "crm_save_contact",
        (v: z.infer<typeof contactInput>) => ({ p_org: v.orgId, p_id: v.id ?? null, p_name: v.name, p_company: blank(v.company), p_email: blank(v.email), p_phone: blank(v.phone), p_source: v.source }),
        (v: z.infer<typeof contactInput>) => (v.id ? ["/crm", `/crm/${v.id}`] : ["/crm"])),

    deleteContact: (raw: unknown) =>
      doneCall(raw, z.object({ orgId: id, id }), "crm_delete_contact",
        (v: { orgId: string; id: string }) => ({ p_org: v.orgId, p_id: v.id }), () => ["/crm"]),

    async importCsv(raw: unknown): Promise<ImportResult> {
      const parsed = importInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const file = parseContactsCsv(parsed.data.csv);
      if (!file.ok) return { ok: false, code: `csv_${file.code}` as CsvFailure };
      const g = await gate();
      if (!g.ok) return g;
      const r = await call("crm_import_contacts", {
        p_org: parsed.data.orgId, p_attested: true,
        p_rows: file.rows.map(({ name, email, company, phone }) => ({ name, email, company, phone })),
      }, ["/crm"]);
      if (!r.ok) return r;
      const d = r.data as { imported?: unknown; duplicate?: unknown; invalid?: unknown; limit?: unknown } | null;
      if (!d || typeof d.imported !== "number" || typeof d.duplicate !== "number" || typeof d.limit !== "number" || !Array.isArray(d.invalid)) return { ok: false, code: "error" };
      const invalidLines = d.invalid.flatMap((i) => (typeof i === "number" && file.rows[i - 1] ? [file.rows[i - 1]!.line] : []));
      return { ok: true, report: { imported: d.imported, duplicate: d.duplicate, invalidLines, limit: d.limit } };
    },

    saveDeal: (raw: unknown) =>
      idCall(raw, dealInput, "crm_save_deal",
        (v: z.infer<typeof dealInput>) => ({ p_org: v.orgId, p_id: v.id ?? null, p_contact: v.contactId, p_title: v.title, p_stage: v.stage, p_value: v.value ?? null, p_currency: v.currency ? v.currency.toUpperCase() : null, p_close: v.expectedClose ?? null }),
        (v: z.infer<typeof dealInput>) => [`/crm/${v.contactId}`]),

    addNote: (raw: unknown) => {
      const p = noteInput.safeParse(raw);
      if (p.success && p.data.followUpAt !== undefined && Number.isNaN(Date.parse(p.data.followUpAt))) return Promise.resolve<IdResult>({ ok: false, code: "invalid" });
      return idCall(raw, noteInput, "crm_add_note",
        (v: z.infer<typeof noteInput>) => ({ p_org: v.orgId, p_contact: v.contactId, p_body: v.body, p_follow_up: v.followUpAt ? new Date(v.followUpAt).toISOString() : null }),
        (v: z.infer<typeof noteInput>) => [`/crm/${v.contactId}`]);
    },

    completeNote: (raw: unknown) =>
      doneCall(raw, z.object({ orgId: id, contactId: id, noteId: id }), "crm_complete_note",
        (v: { orgId: string; noteId: string }) => ({ p_org: v.orgId, p_note: v.noteId }),
        (v: { contactId: string }) => [`/crm/${v.contactId}`]),
  };
}

import { z } from "zod";
import { SETTINGS } from "./settings-registry";

export { SETTINGS };

const reason = z.string().trim().min(10).max(1000);
const keyRe = /^[a-z0-9_.]+$/;

export const settingInput = z
  .object({ key: z.string().refine((k) => k in SETTINGS, "unknown setting"), value: z.unknown(), reason })
  .superRefine((v, ctx) => {
    const def = SETTINGS[v.key];
    if (def && !def.schema.safeParse(v.value).success) ctx.addIssue({ code: "custom", path: ["value"], message: "value out of range" });
  });

/** Turns the text a form sends into a typed value, or { ok: false }. */
export function parseSettingValue(key: string, raw: string): { ok: true; value: unknown } | { ok: false } {
  const def = SETTINGS[key];
  if (!def) return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  return def.schema.safeParse(value).success ? { ok: true, value } : { ok: false };
}

export const flagInput = z.object({ key: z.string().regex(keyRe).max(80), enabled: z.boolean(), reason });
export const orgStatusInput = z.object({ orgId: z.uuid(), status: z.enum(["active", "suspended"]), reason });
export const roleInput = z.object({ userId: z.uuid(), role: z.enum(["admin", "support"]), grant: z.boolean(), reason });
export const planInput = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/).max(60),
  name: z.string().trim().min(1).max(80),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  active: z.boolean(),
  limits: z.record(z.string(), z.unknown()),
  features: z.record(z.string(), z.unknown()),
  reason,
});
export const verificationRequestInput = z.object({
  orgId: z.uuid(),
  note: z.string().trim().min(10).max(1000),
  url: z.string().trim().max(500).regex(/^https:\/\//).optional().or(z.literal("")),
});
export const verificationReviewInput = z.object({ requestId: z.uuid(), decision: z.enum(["approved", "rejected"]), note: reason });
export const revokeVerificationInput = z.object({ orgId: z.uuid(), reason });

export const AUDIT_PAGE_SIZE = 50;
export interface AuditFilters { actor?: string; action?: string; outcome?: "success" | "denied" | "invalid" | "error"; from?: string; to?: string; before?: number }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Reads the audit page's query string. Anything invalid is dropped; this never throws. */
export function parseAuditFilters(q: Record<string, string | string[] | undefined>): AuditFilters {
  const f: AuditFilters = {};
  const actor = one(q.actor)?.trim();
  if (actor && z.uuid().safeParse(actor).success) f.actor = actor;
  const action = one(q.action)?.trim();
  if (action && action.length <= 80 && keyRe.test(action)) f.action = action;
  const outcome = one(q.outcome)?.trim();
  if (outcome === "success" || outcome === "denied" || outcome === "invalid" || outcome === "error") f.outcome = outcome;
  const from = one(q.from)?.trim();
  if (from && isDay(from)) f.from = from;
  const to = one(q.to)?.trim();
  if (to && isDay(to)) f.to = to;
  const before = one(q.before)?.trim();
  if (before && /^\d{1,15}$/.test(before) && Number(before) > 0) f.before = Number(before);
  return f;
}

export function nextCursor(rows: { id: number }[], pageSize: number): number | null {
  return rows.length >= pageSize ? rows[rows.length - 1].id : null;
}

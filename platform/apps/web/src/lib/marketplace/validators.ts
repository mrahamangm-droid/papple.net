import { z } from "zod";

const INT_MAX = 2_147_483_647;
const id = z.uuid();
const money = z.number().int().min(1).max(INT_MAX);
const currency = z.string().regex(/^[A-Z]{3}$/);
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const AVAILABILITY = ["available", "limited", "unavailable"] as const;

/* ---------- search ---------- */
export const searchParams = z.object({
  kind: z.enum(["providers", "services"]),
  q: z.string().transform((s) => s.trim().slice(0, 200)).optional(),
  category: z.preprocess(emptyToUndefined, id.optional()),
  skills: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10) : v),
    z.array(id).max(10).optional(),
  ),
  country: z.preprocess(emptyToUndefined, z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).optional()),
  rate_max: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(INT_MAX).optional()),
  price_max: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(INT_MAX).optional()),
  availability: z.preprocess(emptyToUndefined, z.enum(AVAILABILITY).optional()),
  cursor: z.string().max(200).optional(),
});
export type SearchParams = z.output<typeof searchParams>;

export const isValidUuid = (v: string): boolean => z.uuid().safeParse(v).success;

/* ---------- keyset cursor ---------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function encodeCursor(rank: number, rowId: string): string {
  return Buffer.from(`${rank}|${rowId}`).toString("base64url");
}
/** Anything malformed, tampered or foreign decodes to null (= first page); it never throws. */
export function decodeCursor(cursor: string | undefined): { rank: number; id: string } | null {
  if (!cursor || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const rank = Number(parts[0]);
  if (!Number.isFinite(rank) || parts[0] === "" || !UUID_RE.test(parts[1])) return null;
  return { rank, id: parts[1] };
}

/* ---------- writes ---------- */
export const profileInput = z.object({
  orgId: id,
  headline: trimmed(3, 120),
  summary: z.string().trim().max(5000).default(""),
  country: z.preprocess(emptyToUndefined, z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).optional()),
  languages: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
  hourlyMin: z.number().int().min(0).max(INT_MAX).optional(),
  hourlyMax: z.number().int().min(0).max(INT_MAX).optional(),
  currency: currency.default("USD"),
  availability: z.enum(AVAILABILITY).default("available"),
  visibility: z.enum(["public", "private"]).default("public"),
  skillIds: z.array(id).max(30).default([]),
}).refine((v) => v.hourlyMin === undefined || v.hourlyMax === undefined || v.hourlyMin <= v.hourlyMax, { message: "hourlyMin must not exceed hourlyMax" });

export const serviceInput = z.object({
  orgId: id,
  id: id.optional(),
  categoryId: id.optional(),
  title: trimmed(3, 120),
  description: z.string().trim().max(5000).default(""),
  pricingModel: z.enum(["fixed", "hourly", "quote"]),
  priceMin: z.number().int().min(0).max(INT_MAX).optional(),
  currency: currency.default("USD"),
  deliveryDays: z.number().int().min(1).max(3650).optional(),
  status: z.enum(["draft", "published", "archived"]),
});

export const projectInput = z.object({
  orgId: id,
  id: id.optional(),
  title: trimmed(5, 150),
  description: trimmed(5, 10_000),
  categoryId: id.optional(),
  budgetMin: z.number().int().min(0).max(INT_MAX).optional(),
  budgetMax: z.number().int().min(0).max(INT_MAX).optional(),
  currency: currency.default("USD"),
  deadline: z.iso.date().optional(),
  visibility: z.enum(["public", "members_only"]).default("members_only"),
  skillIds: z.array(id).max(30).default([]),
}).refine((v) => v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMin <= v.budgetMax, { message: "budgetMin must not exceed budgetMax" });

export const proposalInput = z.object({
  orgId: id,
  projectId: id,
  coverLetter: trimmed(1, 5000),
  price: money,
  currency,
  deliveryDays: z.number().int().min(1).max(3650),
});

export const messageInput = z.object({ conversationId: id, orgId: id, body: trimmed(1, 4000) });
export const reportInput = z.object({ kind: z.enum(["profile", "service", "project", "message"]), id, reason: trimmed(1, 1000) });

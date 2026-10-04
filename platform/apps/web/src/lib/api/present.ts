import { z } from "zod";

export type ApiKeyFailure = "forbidden" | "invalid" | "limit" | "rate" | "error";

export const apiKeyFailureMessage = (c: ApiKeyFailure): string => ({
  forbidden: "Only organization owners can manage API keys.",
  invalid: "Check the name (1 to 60 characters) and try again. This organization may not have API access.",
  limit: "Your plan's limit of active API keys is reached. Revoke a key you no longer use, or upgrade your plan.",
  rate: "Too many requests. Please wait a minute and try again.",
  error: "Something went wrong. Please try again.",
}[c]);

const keyRow = z.object({ id: z.string(), name: z.string(), prefix: z.string(), created_at: z.string(), last_used_at: z.string().nullable(), revoked_at: z.string().nullable(), created_by_name: z.string(), creator_active: z.boolean() });
export interface ApiKeyRow { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; createdByName: string; creatorActive: boolean }

/** Rows that are not keys are dropped rather than shown half-broken. */
export function parseKeys(data: unknown): ApiKeyRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => {
    const p = keyRow.safeParse(r);
    return p.success ? [{ id: p.data.id, name: p.data.name, prefix: p.data.prefix, createdAt: p.data.created_at, lastUsedAt: p.data.last_used_at, revokedAt: p.data.revoked_at, createdByName: p.data.created_by_name, creatorActive: p.data.creator_active }] : [];
  });
}

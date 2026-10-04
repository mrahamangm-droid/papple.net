import { z } from "zod";
import { generateApiKey } from "./keys";
import { parseKeys, type ApiKeyFailure, type ApiKeyRow } from "./present";

export type { ApiKeyFailure, ApiKeyRow };
export interface ApiKeyDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who is an owner. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
  generate?: () => { secret: string; prefix: string; hash: string };
}
export type CreateResult = { ok: true; id: string; secret: string; prefix: string } | { ok: false; code: ApiKeyFailure };
export type RevokeResult = { ok: true } | { ok: false; code: ApiKeyFailure };
export type ListResult = { ok: true; keys: ApiKeyRow[] } | { ok: false; code: ApiKeyFailure };

const createInput = z.object({ orgId: z.string().uuid(), name: z.string().trim().min(1).max(60) });
const revokeInput = z.object({ orgId: z.string().uuid(), id: z.string().uuid() });
const failure = (code?: string): ApiKeyFailure => (code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "54000" ? "limit" : "error");
const PAGE = "/settings/api-keys";

export function createApiKeyService(deps: ApiKeyDeps) {
  const gate = async (limited = true): Promise<ApiKeyFailure | null> => {
    const userId = await deps.getUserId();
    if (!userId) return "forbidden";
    if (!limited) return null;
    try {
      return (await deps.throttle(userId)) ? null : "rate";
    } catch {
      return "error";
    }
  };
  return {
    async create(raw: unknown): Promise<CreateResult> {
      const p = createInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const blocked = await gate();
      if (blocked) return { ok: false, code: blocked };
      const key = (deps.generate ?? generateApiKey)();
      try {
        const { data, error } = await deps.rpc("api_key_create", { p_org: p.data.orgId, p_name: p.data.name, p_prefix: key.prefix, p_hash: key.hash });
        if (error) return { ok: false, code: failure(error.code) };
        if (typeof data !== "string") return { ok: false, code: "error" };
        deps.revalidate(PAGE);
        return { ok: true, id: data, secret: key.secret, prefix: key.prefix };
      } catch {
        return { ok: false, code: "error" };
      }
    },
    async revoke(raw: unknown): Promise<RevokeResult> {
      const p = revokeInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const blocked = await gate();
      if (blocked) return { ok: false, code: blocked };
      try {
        const { error } = await deps.rpc("api_key_revoke", { p_org: p.data.orgId, p_id: p.data.id });
        if (error) return { ok: false, code: failure(error.code) };
        deps.revalidate(PAGE);
        return { ok: true };
      } catch {
        return { ok: false, code: "error" };
      }
    },
    async list(orgId: string): Promise<ListResult> {
      if (!z.string().uuid().safeParse(orgId).success) return { ok: false, code: "invalid" };
      const blocked = await gate(false); // reading is not an action: page views and refreshes must never hide the list
      if (blocked) return { ok: false, code: blocked };
      try {
        const { data, error } = await deps.rpc("api_keys_list", { p_org: orgId });
        if (error) return { ok: false, code: failure(error.code) };
        return { ok: true, keys: parseKeys(data) };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}

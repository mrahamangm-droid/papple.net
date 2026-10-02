import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminAction } from "./admin-action";
import { createAuditWriter } from "./audit";
import { parseServerEnv } from "./env";
import { headers } from "next/headers";
import { RULES, RateLimitError, createRateLimiter, enforce, type Rule } from "./ratelimit";
import { createOnboarding, type OnboardingInput } from "./onboarding";
import { createSettings } from "./settings";
import { createServerSupabase, getSessionUser } from "./supabase/server";
import { createServiceClient } from "./supabase/service";

/** Production wiring of the dependency-injected services. Server-only. */
const salt = () => createHash("sha256").update(`audit-ip:${parseServerEnv(process.env).SUPABASE_SERVICE_ROLE_KEY}`).digest("hex");

let auditWriter: ReturnType<typeof createAuditWriter> | undefined;
/** Lazy so that importing this module never requires secrets (e.g. during `next build`). */
export const writeAudit: ReturnType<typeof createAuditWriter> = (entry) => {
  auditWriter ??= createAuditWriter(async (row) => {
    const { error } = await createServiceClient().from("audit_log").insert(row);
    if (error) throw new Error(`audit write failed: ${error.message}`);
  }, salt());
  return auditWriter(entry);
};

export const adminAction = createAdminAction({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  isPlatformAdmin: async (userId) => {
    const { data } = await createServiceClient().from("platform_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    return !!data;
  },
  audit: writeAudit,
  requestId: () => randomUUID(),
});

export const settings = createSettings({
  loadSetting: async (key) => {
    const { data, error } = await createServiceClient().from("platform_settings").select("value").eq("key", key).single();
    if (error) throw new Error(`setting ${key} unavailable`);
    return data.value;
  },
  loadFlag: async (key, orgId) => {
    const db = createServiceClient();
    if (orgId) {
      const { data } = await db.from("feature_flag_overrides").select("enabled").eq("key", key).eq("org_id", orgId).maybeSingle();
      if (data) return data.enabled as boolean;
    }
    const { data } = await db.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
    return (data?.enabled as boolean | undefined) ?? false;
  },
});

export async function completeOnboardingForUser(userId: string, input: OnboardingInput) {
  const userDb = await createServerSupabase();
  const admin = createServiceClient();
  return createOnboarding({
    getProfile: async (uid) => {
      const { data } = await admin.from("profiles").select("persona, status").eq("id", uid).maybeSingle();
      return data ? { persona: (data.persona as string | null) ?? null, status: data.status as string } : null;
    },
    findOwnedOrg: async (uid) => {
      const { data } = await admin.from("memberships").select("org_id").eq("user_id", uid).eq("role", "owner").limit(1).maybeSingle();
      return (data?.org_id as string | undefined) ?? null;
    },
    createOrganization: async (name, type) => {
      const { data, error } = await userDb.rpc("create_organization", { p_name: name, p_type: type });
      if (error) throw new Error("organization creation failed");
      return data as string;
    },
    setProfile: async (uid, p) => {
      const { error } = await admin.from("profiles").update({ persona: p.persona, status: p.status }).eq("id", uid);
      if (error) throw new Error("profile update failed");
    },
  }).completeOnboarding(userId, input);
}

let limiter: ReturnType<typeof createRateLimiter> | undefined;

/** Client IP as set by the trusted edge (Cloudflare/Vercel). Never use for authorization, only for throttling and audit. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
}

/** Returns true if the call may proceed; false if rate limited. */
export async function throttle(rule: keyof typeof RULES, key: string): Promise<boolean> {
  limiter ??= createRateLimiter(parseServerEnv(process.env));
  try {
    await enforce(limiter, `${rule}:${key}`, RULES[rule] satisfies Rule);
    return true;
  } catch (e) {
    if (e instanceof RateLimitError) return false;
    throw e;
  }
}

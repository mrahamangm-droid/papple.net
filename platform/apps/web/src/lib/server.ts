import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminAction } from "./admin-action";
import { createAuditWriter } from "./audit";
import { parseServerEnv } from "./env";
import { headers } from "next/headers";
import { RULES, RateLimitError, createRateLimiter, enforce, type Rule } from "./ratelimit";
import { createOnboarding, type OnboardingInput } from "./onboarding";
import { createSettings } from "./settings";
import { z } from "zod";
import { createMarketplaceDb, type Rpc } from "./marketplace/db";
import { createContractsDb } from "./contracts/db";
import { createSearch } from "./marketplace/search";
import { createPublicData } from "./marketplace/public-data";
import { createGuardedSearch } from "./marketplace/guarded-search";
import { PermanentEmailError, createEmailNotifier } from "./marketplace/notify-email";
import { createServerSupabase, getSessionUser } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { createStripeProvider, type StripeLike } from "./payments/stripe-provider";
import { createPaymentsServiceDb } from "./payments/service-db";
import { createWebhookHandler } from "./payments/webhook-handler";
import { createRefundService } from "./payments/refunds";
import { createAdminConsoleDb } from "./admin/db";
import { createDisputesDb } from "./disputes/db";
import { createDbWebhookStore } from "./webhooks";
import { createAiService } from "./ai/service";
import { createAnthropicClient } from "./ai/client";
import { createInvoiceService } from "./invoices/service";
import { createCrmService } from "./crm/service";
import { createCrmEmailService, EmailRefused } from "./crm/email";
import { signUnsubscribeToken } from "./crm/unsubscribe";
import { createUnsubscribeHandler } from "./crm/unsubscribe-handler";
import { createResendWebhook } from "./crm/resend-webhook";
import { createCredentialService } from "./credentials/service";
import { createTalentService } from "./talent/service";
import { createWorkService } from "./work/service";
import { storage, verifyDeps } from "./r2";
import { verifyUploadedObject } from "./storage";
import { createAnalyticsService } from "./analytics/service";
import { createApiV1 } from "./api/handler";
import { createApiKeyService } from "./api/service";
import { createTeamService } from "./team/service";
import { buildInviteEmail, createInviteMailer } from "./team/email";
import { newInviteToken } from "./team/token";
import { createBillingService } from "./billing/service";
import { createStripeBilling, type StripeBillingLike } from "./payments/billing-provider";
import { formatMinor } from "./marketplace/present";
import type { PaymentProvider } from "./payments/provider";

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

/** Calls a Postgres function as the current user (or as anon when signed out), so RLS and grants apply. */
const userRpc: Rpc = async (fn, args) => {
  const db = await createServerSupabase();
  const { data, error } = await db.rpc(fn, args);
  return { data, error: error ? { code: error.code, message: error.message } : null };
};

export const marketplaceDb = createMarketplaceDb(userRpc);
export const contractsDb = createContractsDb(userRpc);
/** Rulings run through the admin's own session so the database sees their role and second factor. */
export const disputesDb = createDisputesDb(userRpc);
/** Console edits run through the admin's own session so the database sees their role and second factor. */
export const adminConsoleDb = createAdminConsoleDb(userRpc);

export const searchService = createSearch({
  rpc: userRpc,
  pageSize: () => settings.getSetting("search.page_size", z.number().int().min(1).max(50)),
});

/** Public single-card lookups through the anon-capable client; RLS and view whitelists apply. */
export const publicData = createPublicData({
  fetchOne: async (view, slug) => {
    const db = await createServerSupabase();
    const { data, error } = await db.from(view).select("*").eq("slug", slug).maybeSingle();
    return { data, error: error ? { message: error.message } : null };
  },
  fetchMany: async (slug) => {
    const db = await createServerSupabase();
    const { data, error } = await db.from("public_provider_credentials").select("kind, title, issuer, issued_on, expires_on, status").eq("slug", slug).order("issued_on", { ascending: false, nullsFirst: false }).limit(100);
    return { data, error: error ? { message: error.message } : null };
  },
});

/** Active categories for the search filter. A failure just hides the filter. */
export async function publicCategories(): Promise<{ id: string; name: string }[]> {
  try {
    const db = await createServerSupabase();
    const { data } = await db.from("categories").select("id, name").eq("is_active", true).order("position").order("name");
    return (data ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

const EMAIL_DELAY_MS = 10 * 60_000;
const EMAILABLE = ["message_received", "proposal_received"];

/** Sends the neutral unread-nudge emails. Needs RESEND_API_KEY and EMAIL_FROM; without them it fails closed and sends nothing. */
export async function runEmailNotifier(): Promise<{ sent: number }> {
  const admin = createServiceClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return createEmailNotifier({
    delayMs: EMAIL_DELAY_MS,
    isEnabled: () => settings.isFlagEnabled("marketplace.email_notifications"),
    loadUnread: async (olderThanMs) => {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      const stale = new Date(Date.now() - 24 * 3_600_000).toISOString(); // a day-old nudge is no longer a nudge
      const { data } = await admin.from("notifications").select("id, user_id, type, payload")
        .is("read_at", null).is("emailed_at", null).in("type", EMAILABLE).lt("created_at", cutoff).gte("created_at", stale)
        .order("created_at", { ascending: true }).limit(50);
      const out: { id: string; userEmail: string; type: string; link: string }[] = [];
      const noAddress: string[] = [];
      for (const n of data ?? []) {
        const payload = (n.payload ?? {}) as { conversation_id?: string; project_id?: string };
        const path = payload.conversation_id ? `/messages/${payload.conversation_id}` : payload.project_id ? `/projects/${payload.project_id}` : "/notifications";
        const { data: u } = await admin.auth.admin.getUserById(n.user_id as string);
        if (u.user?.email) out.push({ id: n.id as string, userEmail: u.user.email, type: n.type as string, link: `${site}${path}` });
        else noAddress.push(n.id as string); // can never be emailed: retire it so it does not clog the batch
      }
      if (noAddress.length) await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", noAddress);
      return out;
    },
    send: async ({ to, subject, text }) => {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!key || !from || !site) throw new Error("email not configured");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      // 4xx other than 429 means the provider rejected this message or address for good; 429 and 5xx are worth retrying.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentEmailError();
      if (!res.ok) throw new Error(`email provider ${res.status}`);
    },
    markEmailed: async (ids) => {
      await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids);
    },
  }).run();
}

/** Throttled anonymous search for server-rendered pages (same limiter as /api/search). */
export const guardedSearch = createGuardedSearch({ search: searchService, throttle, ip: clientIp });

/** Service-role payment RPCs (webhook, checkout destination). Never hand this to user-facing code paths unchecked. */
export const paymentsServiceDb = () =>
  createPaymentsServiceDb(async (fn, args) => {
    const { data, error } = await createServiceClient().rpc(fn, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  });

let stripeProvider: PaymentProvider | undefined;
/** Lazy: importing this module never needs Stripe keys. Throws if payments are not configured. */
export function paymentProvider(): PaymentProvider {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) throw new Error("payments not configured");
  // Stripe signs platform events and Connect events (account.updated) with different endpoint secrets.
  const secrets = [webhookSecret, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => !!x);
  stripeProvider ??= createStripeProvider(new Stripe(key) as unknown as StripeLike, secrets);
  return stripeProvider;
}

/** Sends queued refunds. Lazy like the provider: importing this module never needs Stripe keys. */
export const refundService = () => createRefundService({ db: paymentsServiceDb(), provider: paymentProvider() });

/** Verified Stripe webhook entry point. Answers 503 (Stripe retries) until the keys exist. */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<{ status: number }> {
  let provider: PaymentProvider;
  try {
    provider = paymentProvider();
  } catch {
    return { status: 503 };
  }
  return createWebhookHandler({
    provider,
    store: createDbWebhookStore(createServiceClient()),
    db: paymentsServiceDb(),
    alert: (message, context) => {
      console.error(message, context);
      Sentry.captureMessage(message, { level: "error", extra: context });
    },
  })(rawBody, signature);
}


/** The assistant is offered only when a provider key exists and the `ai.assistant` flag is on for the organization. */
function aiClient() {
  try {
    const env = parseServerEnv(process.env);
    return env.ANTHROPIC_API_KEY ? createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL ?? "claude-sonnet-5-5" }) : null;
  } catch {
    return null;
  }
}

export function aiKeyConfigured(): boolean {
  try { return !!parseServerEnv(process.env).ANTHROPIC_API_KEY; } catch { return false; }
}

export async function aiEnabledFor(orgId?: string): Promise<boolean> {
  try {
    if (!parseServerEnv(process.env).ANTHROPIC_API_KEY) return false;
    return await settings.isFlagEnabled("ai.assistant", orgId);
  } catch {
    return false;
  }
}

export const aiService = createAiService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("ai", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  get client() { return aiClient(); },
  loadProposalContext: async (orgId, projectId) => {
    const db = await createServerSupabase();
    const { data: proj } = await db.from("projects").select("title, description, budget_min, budget_max, currency").eq("id", projectId).eq("status", "open").maybeSingle();
    if (!proj) return null;
    const { data: prof } = await db.from("provider_profiles").select("id, headline, summary").eq("org_id", orgId).maybeSingle();
    if (!prof) return null;
    const { data: sk } = await db.from("provider_skills").select("skills(name)").eq("profile_id", prof.id);
    const cur = proj.currency as string;
    const lo = proj.budget_min as number | null; const hi = proj.budget_max as number | null;
    const budget = lo != null && hi != null ? `${formatMinor(lo, cur)} to ${formatMinor(hi, cur)}` : lo != null ? `from ${formatMinor(lo, cur)}` : hi != null ? `up to ${formatMinor(hi, cur)}` : undefined;
    const skills = ((sk ?? []) as unknown as { skills: { name: string } | { name: string }[] | null }[]).flatMap((r) => (Array.isArray(r.skills) ? r.skills : r.skills ? [r.skills] : []).map((x) => x.name));
    return { project: { title: proj.title as string, description: proj.description as string, budget }, profile: { headline: prof.headline as string, summary: (prof.summary as string) ?? "", skills } };
  },
});

/** Subscription billing on the platform Stripe account. Null until STRIPE_SECRET_KEY exists; the page then says billing is unavailable. */
function billingProvider() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? createStripeBilling(new Stripe(key) as unknown as StripeBillingLike) : null;
}

export const billingService = createBillingService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("billing", `user:${userId}`),
  canManageBilling: async (orgId) => {
    const { data, error } = await userRpc("can_manage_billing", { p_org: orgId });
    if (error) throw new Error("billing check failed");
    return data === true;
  },
  loadPlan: async (key) => {
    const { data } = await createServiceClient().from("plans").select("key, active, stripe_price_id").eq("key", key).maybeSingle();
    return data ? { key: data.key as string, active: data.active as boolean, stripePriceId: (data.stripe_price_id as string | null) ?? null } : null;
  },
  loadSubscription: async (orgId) => {
    const { data } = await createServiceClient().from("subscriptions").select("status, stripe_customer_id").eq("org_id", orgId).maybeSingle();
    return data ? { status: data.status as string, customerId: (data.stripe_customer_id as string | null) ?? null } : null;
  },
  get billing() { return billingProvider(); },
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://papple.net").replace(/\/$/, ""),
});

/** CRM writes run through the signed-in user's own session: the database decides who may write. */
export const crmService = (revalidate: (path: string) => void) => createCrmService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("crm", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
});

const CRM_SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const CRM_UNSUB_SECRET = () => process.env.CRM_UNSUBSCRIBE_SECRET;
/** Plain address from EMAIL_FROM, which may be `Name <addr>` or just `addr`. */
const fromAddress = (from: string) => (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from).trim();
/** Display names go into a header: drop anything that could end the name or the header. */
const displayName = (name: string) => name.replace(/[\r\n"<>,;:\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Credential edits run through the signed-in user's own session: the database decides who may edit and review. */
export const credentialService = (revalidate: (path: string) => void) => createCredentialService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("credential", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
});

/** API keys are managed through the signed-in user's own session: the database decides who is an owner. */
export const apiKeyService = (revalidate: (path: string) => void) => createApiKeyService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("apikeys", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
});

/** The public read-only API: no session. A key resolves to one organization and every read is scoped to it by the service-only RPCs. */
export const apiV1 = () => createApiV1({
  authenticate: async (hash) => {
    const { data, error } = await createServiceClient().rpc("api_key_authenticate", { p_hash: hash });
    if (error) throw new Error("authenticate failed");
    return typeof data === "string" ? data : null;
  },
  throttle: (kind, key) => (kind === "ip" ? throttle("apiv1ip", `ip:${key}`) : throttle("apiv1", `key:${key}`)),
  rpc: async (fn, args) => {
    const { data, error } = await createServiceClient().rpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
});

/** Analytics are read through the signed-in user's own session: the database decides who may see an organization's numbers. */
export const analyticsService = () => createAnalyticsService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("analytics", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
});

/** Talent pools and invitations run through the signed-in user's own session: the database decides who may add, invite or decline. */
export const talentService = (revalidate: (path: string) => void) => createTalentService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("talent", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
});

/** Tasks, time and contract files run through the signed-in user's own session: the database decides who may read or change what. */
export const workService = (revalidate: (path: string) => void) => createWorkService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("work", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
  storage: { signUploadUrl: (key, mime, size) => storage.signUploadUrl(key, mime, size), signDownloadUrl: (key) => storage.signDownloadUrl(key) },
  verify: (key, declared) => verifyUploadedObject(verifyDeps, key, declared),
  removeObject: (key) => verifyDeps.remove(key),
  // Only the service role may record a verification, so a signed-in user cannot mark an unchecked upload ready.
  markVerified: async (fileId, size) => {
    const { error } = await createServiceClient().rpc("file_mark_verified", { p_file: fileId, p_size: size });
    return { error: error ? { code: error.code } : null };
  },
  newId: () => randomUUID(),
});

/** Team management runs through the signed-in user's own session: the database decides who may invite, change roles or remove. */
export const teamService = (revalidate: (path: string) => void) => createTeamService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("team", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
  siteUrl: () => CRM_SITE(),
  newToken: newInviteToken,
  emailInvite: async ({ orgId, userId, to, role, link, inviteId }) => {
    const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
    const admin = createServiceClient();
    const { data: flag } = await admin.from("feature_flags").select("enabled").eq("key", "team.email_invites").maybeSingle();
    if (!flag?.enabled || !key || !from) return "off";
    const [{ data: org }, { data: prof }, { data: u }] = await Promise.all([
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    const m = buildInviteEmail({ orgName: (org?.name as string | undefined) ?? "", inviterName: (prof?.display_name as string | null) ?? u.user?.email ?? "", role, link });
    try {
      await createInviteMailer({ apiKey: key, from: `PAPple <${fromAddress(from)}>` })({ to, subject: m.subject, text: m.text, idempotencyKey: `team-invite-${inviteId}` });
      return "sent";
    } catch {
      return "failed";
    }
  },
});

/** One-to-one CRM email. Sends nothing unless the key, sender, site URL and unsubscribe secret all exist; the database has the final say on who may be emailed. */
export const crmEmailService = (revalidate: (path: string) => void) => createCrmEmailService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("crmemail", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  isConfigured: () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && CRM_SITE() && (CRM_UNSUB_SECRET()?.length ?? 0) >= 16),
  unsubscribeUrl: (orgId, email) => `${CRM_SITE()}/crm-unsubscribe?t=${signUnsubscribeToken(CRM_UNSUB_SECRET() ?? "", orgId, email)}`,
  replyTo: async (userId) => (await createServiceClient().auth.admin.getUserById(userId)).data.user?.email ?? null,
  send: async ({ to, subject, text, replyTo, fromName, unsubscribeUrl, idempotencyKey }) => {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("email not configured");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: `${displayName(fromName)} via PAPple <${fromAddress(from)}>`, to, subject, text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    // A 4xx other than 429 or 408 means the provider looked at the message and said no. Anything else (5xx, a timeout, a dropped connection) leaves the outcome unknown.
    if (res.status >= 400 && res.status < 500 && ![408, 409].includes(res.status)) throw new EmailRefused(`email provider ${res.status}`);
    if (!res.ok) throw new Error(`email provider ${res.status}`);
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof body?.id === "string" && body.id !== "" ? body.id : null;
  },
  mark: async (id, status, provider) => {
    const { error } = await createServiceClient().rpc("crm_mark_email", { p_id: id, p_status: status, p_provider: provider });
    if (error) throw new Error("could not record the outcome");
  },
  revalidate,
});

/** Public unsubscribe page: the signed token in the link is the only authority. */
export const crmUnsubscribe = async () => {
  const ip = await clientIp();
  return createUnsubscribeHandler({
    secret: CRM_UNSUB_SECRET(),
    throttle: () => throttle("unsubscribe", `ip:${ip}`),
    suppress: async (orgId, email) => {
      const { error } = await createServiceClient().rpc("crm_add_suppression", { p_org: orgId, p_email: email, p_reason: "unsubscribe" });
      if (error) throw new Error("suppression failed");
    },
  });
};

/** Resend calls this directly; authenticity comes only from the Svix signature over the raw body. */
export const handleResendWebhook = (raw: string, headers: { id: string | null; timestamp: string | null; signature: string | null }) =>
  createResendWebhook({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    suppress: async (providerId, reason) => {
      const { data, error } = await createServiceClient().rpc("crm_suppress_by_provider_id", { p_provider: providerId, p_reason: reason });
      if (error) throw new Error("suppression failed");
      return data === true;
    },
  }).handle(raw, headers);

/** Invoices run through the signed-in user's own session: the database decides who may issue. */
export const invoiceService = (revalidate: (path: string) => void) => createInvoiceService({
  getUserId: async () => (await getSessionUser())?.id ?? null,
  throttle: (userId) => throttle("invoice", `user:${userId}`),
  rpc: async (fn, args) => {
    const { data, error } = await userRpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  },
  revalidate,
});

import "server-only";
import { forbidden, redirect } from "next/navigation";
import { decideAccess, type AuthContext, type Capability, type OrgRole, type PlatformRole } from "./rbac";
import type { Persona } from "./onboarding";
import { createServerSupabase, getSessionUser } from "./supabase/server";

/** Loads memberships and platform roles through the user's own session, so RLS applies. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const db = await createServerSupabase();
  const [m, p, prof, aal] = await Promise.all([
    db.from("memberships").select("org_id, role").eq("user_id", user.id),
    db.from("platform_roles").select("role").eq("user_id", user.id),
    db.from("profiles").select("persona").eq("id", user.id).maybeSingle(),
    db.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  return {
    userId: user.id,
    memberships: (m.data ?? []).map((r) => ({ orgId: r.org_id as string, role: r.role as OrgRole })),
    platformRoles: (p.data ?? []).map((r) => r.role as PlatformRole),
    persona: (prof.data?.persona as Persona | null) ?? null,
    aal: (aal.data?.currentLevel as "aal1" | "aal2" | null | undefined) ?? null,
  };
}

/** Use at the top of every protected page, action and route handler. */
export async function requireCapability(cap: Capability, orgId?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  const decision = decideAccess(ctx, cap, orgId);
  if (decision === "unauthenticated") redirect("/signin");
  if (decision === "mfa_required") redirect("/mfa");
  if (decision === "forbidden") forbidden();
  return ctx!;
}

/** For route handlers: JSON 401/403 instead of redirects. Returns the context or a Response to return. */
export async function authorizeApi(cap: Capability, orgId?: string): Promise<AuthContext | Response> {
  const ctx = await getAuthContext();
  const d = decideAccess(ctx, cap, orgId);
  if (d === "unauthenticated") return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (d === "mfa_required") return Response.json({ error: "mfa_required" }, { status: 403 });
  if (d === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
  return ctx!;
}

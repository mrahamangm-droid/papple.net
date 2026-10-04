import "server-only";
import { z } from "zod";
import type { AuthContext, OrgRole } from "../rbac";
import { createServerSupabase } from "../supabase/server";
import { settings } from "../server";
import type { MatchProject, MatchProvider, MatchWeights } from "./matching";

export interface OrgChoice { id: string; name: string; role: OrgRole }

/** Organizations the user may act for. The database re-checks every write; this only avoids offering impossible choices. */
export async function eligibleOrgs(ctx: AuthContext, roles: OrgRole[]): Promise<OrgChoice[]> {
  const mine = ctx.memberships.filter((m) => roles.includes(m.role));
  if (mine.length === 0) return [];
  const db = await createServerSupabase();
  const { data } = await db.from("organizations").select("id, name").in("id", mine.map((m) => m.orgId));
  const names = new Map((data ?? []).map((o) => [o.id as string, o.name as string]));
  return mine.map((m) => ({ id: m.orgId, name: names.get(m.orgId) ?? "Organization", role: m.role }));
}

const weightsSchema = z.object({ skills: z.number(), category: z.number(), budget: z.number(), availability: z.number(), language: z.number() });
export async function matchWeights(): Promise<MatchWeights> {
  return settings.getSetting("matching.weights", weightsSchema);
}

type Candidate = { match: MatchProvider; slug: string; headline: string };

/**
 * Match candidates. Other people's providers come from `provider_match_candidates` (public + active, never the viewer's own,
 * no org ids): the base tables are member-only under RLS. `ownOrgIds` reads the viewer's own profiles, which RLS does allow.
 */
export async function candidateProviders(opts: { limit?: number; ownOrgIds?: string[] } = {}): Promise<Candidate[]> {
  const db = await createServerSupabase();
  if (!opts.ownOrgIds) {
    const { data } = await db.from("provider_match_candidates")
      .select("id, slug, headline, hourly_min, hourly_max, availability, languages, skill_ids, category_ids").limit(opts.limit ?? 200);
    return (data ?? []).map((r) => ({
      slug: r.slug as string, headline: r.headline as string,
      match: {
        id: r.id as string, skillIds: (r.skill_ids as string[]) ?? [], categoryIds: (r.category_ids as string[]) ?? [],
        hourlyMin: r.hourly_min as number | null, hourlyMax: r.hourly_max as number | null,
        availability: r.availability as MatchProvider["availability"], languages: (r.languages as string[]) ?? [],
      },
    }));
  }
  const { data: profs } = await db.from("provider_profiles")
    .select("id, org_id, slug, headline, hourly_min, hourly_max, availability, languages").in("org_id", opts.ownOrgIds).limit(opts.limit ?? 200);
  const rows = profs ?? [];
  if (rows.length === 0) return [];
  const [skills, services] = await Promise.all([
    db.from("provider_skills").select("profile_id, skill_id").in("profile_id", rows.map((r) => r.id)),
    db.from("services").select("org_id, category_id").eq("status", "published").in("org_id", rows.map((r) => r.org_id)),
  ]);
  return rows.map((r) => ({
    slug: r.slug as string, headline: r.headline as string,
    match: {
      id: r.id as string,
      skillIds: (skills.data ?? []).filter((x) => x.profile_id === r.id).map((x) => x.skill_id as string),
      categoryIds: (services.data ?? []).filter((x) => x.org_id === r.org_id && x.category_id).map((x) => x.category_id as string),
      hourlyMin: r.hourly_min as number | null, hourlyMax: r.hourly_max as number | null,
      availability: r.availability as MatchProvider["availability"], languages: (r.languages as string[]) ?? [],
    },
  }));
}

export async function projectAsMatch(projectId: string): Promise<MatchProject | null> {
  const db = await createServerSupabase();
  const { data: p } = await db.from("projects").select("id, category_id, budget_min, budget_max").eq("id", projectId).maybeSingle();
  if (!p) return null;
  const { data: sk } = await db.from("project_skills").select("skill_id").eq("project_id", projectId);
  return { id: p.id as string, categoryId: p.category_id as string | null, budgetMin: p.budget_min as number | null, budgetMax: p.budget_max as number | null,
    skillIds: (sk ?? []).map((s) => s.skill_id as string), languages: [] };
}

export async function skillOptions(): Promise<{ id: string; name: string }[]> {
  const db = await createServerSupabase();
  const { data } = await db.from("skills").select("id, name").eq("is_active", true).order("name").limit(500);
  return (data ?? []) as { id: string; name: string }[];
}

/** Open projects visible to the viewer, shaped for the matcher. Capped for cost. */
export async function openProjects(limit = 60): Promise<{ id: string; title: string; currency: string; match: MatchProject }[]> {
  const db = await createServerSupabase();
  const { data: ps } = await db.from("projects").select("id, title, currency, category_id, budget_min, budget_max").eq("status", "open").order("created_at", { ascending: false }).limit(limit);
  const rows = ps ?? [];
  if (rows.length === 0) return [];
  const { data: sk } = await db.from("project_skills").select("project_id, skill_id").in("project_id", rows.map((r) => r.id));
  return rows.map((p) => ({
    id: p.id as string, title: p.title as string, currency: p.currency as string,
    match: { id: p.id as string, categoryId: p.category_id as string | null, budgetMin: p.budget_min as number | null, budgetMax: p.budget_max as number | null,
      skillIds: (sk ?? []).filter((s) => s.project_id === p.id).map((s) => s.skill_id as string), languages: [] },
  }));
}

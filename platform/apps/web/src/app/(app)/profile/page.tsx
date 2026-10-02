import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { ProfileForm } from "@/components/marketplace/ProfileForm";
import { requireCapability } from "@/lib/auth-context";
import { eligibleOrgs, skillOptions } from "@/lib/marketplace/page-data";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const ctx = await requireCapability("org.read");
  const orgs = await eligibleOrgs(ctx, ["owner", "admin"]);
  const q = (await searchParams).org;
  const chosen = orgs.length === 1 ? orgs[0] : orgs.find((o) => o.id === (Array.isArray(q) ? q[0] : q));
  if (!chosen) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">My profile</h1>
        {orgs.length === 0
          ? <Card className="mt-6"><p className="text-sm">Only an owner or admin of an organization can edit its public profile.</p></Card>
          : <ul className="mt-6 space-y-2">{orgs.map((o) => <li key={o.id}><Link className="underline" href={`/profile?org=${o.id}`}>Edit profile for {o.name}</Link></li>)}</ul>}
      </AppShell>
    );
  }
  const db = await createServerSupabase();
  const [{ data: p }, skills] = await Promise.all([
    db.from("provider_profiles").select("id, slug, headline, summary, country, languages, hourly_min, hourly_max, currency, availability, visibility").eq("org_id", chosen.id).maybeSingle(),
    skillOptions(),
  ]);
  const { data: ps } = p ? await db.from("provider_skills").select("skill_id").eq("profile_id", p.id) : { data: [] };
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Profile for {chosen.name}</h1>
      {p && <p className="mt-1 text-sm">Public page: <Link className="underline" href={`/p/${p.slug}`}>/p/{p.slug}</Link>{p.visibility === "private" ? " (currently private)" : ""}</p>}
      <div className="mt-6 max-w-2xl">
        <ProfileForm orgId={chosen.id} skills={skills} defaults={p ? {
          headline: p.headline, summary: p.summary, country: p.country ?? undefined, languages: p.languages, hourlyMin: p.hourly_min, hourlyMax: p.hourly_max,
          currency: p.currency, availability: p.availability, visibility: p.visibility, skillIds: (ps ?? []).map((x) => x.skill_id as string),
        } : undefined} />
      </div>
    </AppShell>
  );
}

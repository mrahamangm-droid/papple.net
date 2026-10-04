import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { requireCapability } from "@/lib/auth-context";
import { formatMinor } from "@/lib/marketplace/present";
import { recommendProjects } from "@/lib/marketplace/matching";
import { candidateProviders, matchWeights, openProjects } from "@/lib/marketplace/page-data";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function Projects() {
  const ctx = await requireCapability("org.read");
  const orgIds = ctx.memberships.map((m) => m.orgId);
  const db = await createServerSupabase();
  const [{ data: mine }, open, own, weights] = await Promise.all([
    orgIds.length ? db.from("projects").select("id, title, status, budget_min, budget_max, currency").in("org_id", orgIds).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    openProjects(),
    orgIds.length ? candidateProviders({ ownOrgIds: orgIds, limit: 1 }) : Promise.resolve([]),
    matchWeights(),
  ]);
  const myIds = new Set((mine ?? []).map((p) => p.id as string));
  const browse = open.filter((p) => !myIds.has(p.id));
  const recommended = own[0] ? recommendProjects(own[0].match, browse.map((b) => b.match), weights, 5) : [];
  const title = new Map(browse.map((b) => [b.id, b.title]));
  return (
    <AppShell ctx={ctx}>
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Projects</h1><Link href="/projects/new" className="underline text-sm">Post a project</Link></div>
      {recommended.length > 0 && (
        <section className="mt-6" aria-label="Recommended for you">
          <h2 className="text-lg font-semibold">Recommended for you</h2>
          <ul className="mt-2 space-y-2">
            {recommended.map((r) => (
              <li key={r.project.id} className="text-sm"><Link className="underline" href={`/projects/${r.project.id}`}>{title.get(r.project.id)}</Link>{r.reasons.length > 0 && <span className="opacity-70"> — {r.reasons.join(" · ")}</span>}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-8" aria-label="Your projects">
        <h2 className="text-lg font-semibold">Your projects</h2>
        <ul className="mt-2 space-y-1">
          {(mine ?? []).map((p) => <li key={p.id} className="text-sm"><Link className="underline" href={`/projects/${p.id}`}>{p.title}</Link> · {p.status}</li>)}
          {(mine ?? []).length === 0 && <li className="text-sm">You have not posted a project yet.</li>}
        </ul>
      </section>
      <section className="mt-8" aria-label="Open projects">
        <h2 className="text-lg font-semibold">Open projects</h2>
        <ul className="mt-2 space-y-1">
          {browse.map((p) => <li key={p.id} className="text-sm"><Link className="underline" href={`/projects/${p.id}`}>{p.title}</Link>{p.match.budgetMax != null && <span className="opacity-70"> · up to {formatMinor(p.match.budgetMax, p.currency)}</span>}</li>)}
          {browse.length === 0 && <li className="text-sm">No open projects right now.</li>}
        </ul>
      </section>
    </AppShell>
  );
}

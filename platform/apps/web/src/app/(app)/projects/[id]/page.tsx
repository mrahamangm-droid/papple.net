import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { ContactForm } from "@/components/marketplace/ContactForm";
import { HireButton } from "@/components/contracts/ContractButtons";
import { DecideButtons } from "@/components/marketplace/DecideButtons";
import { ProjectStatusButtons } from "@/components/marketplace/ProjectStatusButtons";
import { ProposalForm } from "@/components/marketplace/ProposalForm";
import { ProposalList, type ProposalRow } from "@/components/marketplace/ProposalList";
import { ReportButton } from "@/components/marketplace/ReportButton";
import { WithdrawButton } from "@/components/marketplace/WithdrawButton";
import { requireCapability } from "@/lib/auth-context";
import { rankProviders } from "@/lib/marketplace/matching";
import { candidateProviders, eligibleOrgs, matchWeights, projectAsMatch } from "@/lib/marketplace/page-data";
import { formatMinor } from "@/lib/marketplace/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = { title: "Project" };
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data: p } = await db.from("projects").select("id, org_id, title, description, budget_min, budget_max, currency, deadline, status, visibility").eq("id", id).maybeSingle();
  if (!p) notFound(); // RLS hides drafts and other orgs' projects, so this is also the not-allowed case

  const clientRole = ctx.memberships.find((m) => m.orgId === p.org_id)?.role;
  const isClient = clientRole !== undefined;
  const canManage = clientRole === "owner" || clientRole === "admin" || clientRole === "member";
  const canHire = clientRole === "owner" || clientRole === "admin";

  const { data: props } = await db.from("proposals").select("id, org_id, cover_letter, price, currency, delivery_days, status").eq("project_id", id).order("submitted_at", { ascending: false });
  const { data: names } = (props ?? []).length ? await db.from("proposal_providers").select("proposal_id, headline").eq("project_id", id) : { data: [] };
  const label = new Map((names ?? []).map((n) => [n.proposal_id as string, n.headline as string]));
  const rows: ProposalRow[] = (props ?? []).map((x) => ({
    id: x.id as string, orgName: label.get(x.id as string) ?? "Provider", coverLetter: x.cover_letter as string, price: x.price as number,
    currency: x.currency as string, deliveryDays: x.delivery_days as number, status: x.status as string,
  }));

  const { data: contract } = await db.from("contracts").select("id").eq("project_id", id).maybeSingle(); // RLS: only the two parties see it
  const providerOrgs = isClient ? [] : await eligibleOrgs(ctx, ["owner", "admin", "member"]);
  const ownActive = !isClient ? (props ?? []).find((x) => x.status === "submitted" || x.status === "shortlisted") : undefined;

  let ranked: Awaited<ReturnType<typeof rankProviders>> = [];
  let headline = new Map<string, { slug: string; headline: string }>();
  if (isClient && canManage && p.status === "open") {
    const [match, cands, w] = await Promise.all([projectAsMatch(id), candidateProviders({ limit: 200 }), matchWeights()]);
    if (match) {
      ranked = rankProviders(match, cands.map((c) => c.match), w, 5);
      headline = new Map(cands.map((c) => [c.match.id, { slug: c.slug, headline: c.headline }]));
    }
  }

  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      <p className="mt-1 text-sm opacity-70">
        {[p.status, p.budget_max != null ? `Budget up to ${formatMinor(p.budget_max as number, p.currency as string)}` : null, p.deadline ? `Deadline ${p.deadline}` : null].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-4 whitespace-pre-line">{p.description}</p>
      {isClient && canManage && <div className="mt-4"><ProjectStatusButtons orgId={p.org_id as string} id={id} status={p.status as string} /></div>}

      {isClient ? (
        <>
          <section className="mt-8" aria-label="Proposals">
            <h2 className="text-lg font-semibold">Proposals</h2>
            <div className="mt-3">
              <ProposalList proposals={rows} renderActions={canManage ? (r) => (
                r.status === "hired" && contract ? <Link className="underline text-sm" href={`/contracts/${contract.id}`}>Open contract</Link>
                : r.status === "submitted" || r.status === "shortlisted" ? (
                  <div className="space-y-2">
                    <DecideButtons id={r.id} projectId={id} />
                    {r.status === "shortlisted" && canHire && p.status === "open" && <HireButton orgId={p.org_id as string} proposalId={r.id} projectId={id} />}
                  </div>
                ) : null) : undefined} />
            </div>
          </section>
          {ranked.length > 0 && (
            <section className="mt-8" aria-label="Suggested professionals">
              <h2 className="text-lg font-semibold">Suggested professionals</h2>
              <ul className="mt-2 space-y-2">
                {ranked.map((r) => {
                  const h = headline.get(r.provider.id);
                  return h ? <li key={r.provider.id} className="text-sm"><Link className="underline" href={`/p/${h.slug}`}>{h.headline}</Link>{r.reasons.length > 0 && <span className="opacity-70"> — {r.reasons.join(" · ")}</span>}</li> : null;
                })}
              </ul>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="mt-8" aria-label="Your proposal">
            <h2 className="text-lg font-semibold">Your proposal</h2>
            <div className="mt-3">
              <ProposalList proposals={rows} renderActions={ownActive ? (r) => (r.id === ownActive.id && r.status === "submitted" ? <WithdrawButton orgId={ownActive.org_id as string} id={r.id} projectId={id} /> : null) : undefined} />
            </div>
            {!ownActive && p.status === "open" && <Card className="mt-4 max-w-2xl"><ProposalForm projectId={id} orgs={providerOrgs} currency={p.currency as string} /></Card>}
          </section>
          <section className="mt-8 max-w-2xl" aria-label="Ask a question">
            <h2 className="text-lg font-semibold">Message the client</h2>
            <div className="mt-3"><ContactForm kind="project" refId={id} orgs={providerOrgs} /></div>
          </section>
          <div className="mt-6"><ReportButton kind="project" id={id} /></div>
        </>
      )}
    </AppShell>
  );
}

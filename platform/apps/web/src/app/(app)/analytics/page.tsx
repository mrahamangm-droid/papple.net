import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { requireCapability } from "@/lib/auth-context";
import { analyticsFailureMessage, DEFINITIONS, formatDays, formatPct, normalizeDays, WINDOWS, windowNote } from "@/lib/analytics/present";
import { formatMinor } from "@/lib/marketplace/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { analyticsService } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Hiring analytics" };
export const dynamic = "force-dynamic";

const ELIGIBLE = ["client_company", "enterprise", "agency"];
const Tile = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
    <dt className="text-sm opacity-80">{label}</dt>
    <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    {hint && <dd className="mt-1 text-xs opacity-70">{hint}</dd>}
  </div>
);
const th = "py-2 pr-4 text-left font-medium";
const td = "py-2 pr-4";

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const ctx = await requireCapability("org.read");
  const sp = await searchParams;
  const wanted = (Array.isArray(sp.org) ? sp.org[0] : sp.org) ?? "";
  const days = normalizeDays(sp.days);
  const managed = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.orgId);
  const db = await createServerSupabase();
  const { data: orgs } = managed.length ? await db.from("organizations").select("id, name, type, status").in("id", managed) : { data: [] };
  const eligible = (orgs ?? []).filter((o) => ELIGIBLE.includes(o.type as string) && o.status === "active");
  const org = eligible.find((o) => o.id === wanted && isValidUuid(wanted)) ?? eligible[0];
  if (!org) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">Hiring analytics</h1>
        <p className="mt-2 max-w-2xl text-sm">{analyticsFailureMessage("forbidden")}</p>
      </AppShell>
    );
  }
  const orgId = org.id as string;
  const result = await analyticsService().load({ orgId, days });
  const link = (o: string, d: number) => `/analytics?org=${o}&days=${d}`;
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Hiring analytics</h1>
      <p className="mt-2 max-w-2xl text-sm">How hiring is going for {org.name as string}: what you posted, what came back, how fast you hire and what you committed and paid. These are your organization&apos;s numbers only.</p>
      {eligible.length > 1 && (
        <nav aria-label="Organization" className="mt-4 flex flex-wrap gap-2 text-sm">
          {eligible.map((o) => <Link key={o.id as string} href={link(o.id as string, days)} aria-current={o.id === org.id ? "page" : undefined} className={`rounded-md border px-3 py-1 ${o.id === org.id ? "border-blue-600 font-medium" : "border-neutral-400"}`}>{o.name as string}</Link>)}
        </nav>
      )}
      <nav aria-label="Time window" className="mt-4 flex flex-wrap gap-2 text-sm">
        {WINDOWS.map((d) => <Link key={d} href={link(orgId, d)} aria-current={d === days ? "page" : undefined} className={`rounded-md border px-3 py-1 ${d === days ? "border-blue-600 font-medium" : "border-neutral-400"}`}>Last {d} days</Link>)}
      </nav>
      {!result.ok && <p role="alert" className="mt-6 text-sm">{analyticsFailureMessage(result.code)}</p>}
      {result.ok && (() => {
        const a = result.data;
        const note = windowNote(a);
        return (
          <>
            {note && <p role="status" className="mt-4 text-sm">{note}</p>}
            <h2 className="mt-8 font-medium">Hiring</h2>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Projects posted" value={a.projects.posted} hint={`${a.projects.open} open · ${a.projects.closed} closed · ${a.projects.cancelled} cancelled${a.projects.other > 0 ? ` · ${a.projects.other} other` : ""}`} />
              <Tile label="Proposals received" value={a.proposals.received} hint={a.proposals.avg_per_project == null ? undefined : `${a.proposals.avg_per_project} per project · ${a.proposals.shortlisted} shortlisted`} />
              <Tile label="Hire rate" value={formatPct(a.hiring.hire_rate_pct)} hint={`${a.hiring.hired} accepted ${a.hiring.hired === 1 ? "contract" : "contracts"} created in the window${a.contracts.draft > 0 ? `, ${a.contracts.draft} offer${a.contracts.draft === 1 ? "" : "s"} waiting` : ""}`} />
              <Tile label="Median time to hire" value={formatDays(a.hiring.median_days_to_hire)} />
            </dl>
            <h2 className="mt-8 font-medium">Money</h2>
            {a.money.length === 0 ? <p className="mt-2 text-sm">No contracts or payments in this window.</p> : (
              <table className="mt-2 w-full max-w-3xl text-sm">
                <caption className="sr-only">Committed, paid, fees and refunds by currency</caption>
                <thead><tr><th scope="col" className={th}>Currency</th><th scope="col" className={th}>Committed</th><th scope="col" className={th}>Paid</th><th scope="col" className={th}>Fees</th><th scope="col" className={th}>Refunded</th></tr></thead>
                <tbody>
                  {a.money.map((m) => (
                    <tr key={m.currency} className="border-t border-neutral-200 dark:border-neutral-800">
                      <th scope="row" className={`${td} font-medium`}>{m.currency}</th>
                      <td className={td}>{formatMinor(m.committed, m.currency)}</td>
                      <td className={td}>{formatMinor(m.paid, m.currency)}</td>
                      <td className={td}>{formatMinor(m.client_fees, m.currency)}</td>
                      <td className={td}>{formatMinor(m.refunded, m.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h2 className="mt-8 font-medium">Contracts created</h2>
            <p className="mt-2 text-sm">{a.contracts.active} active · {a.contracts.completed} completed · {a.contracts.disputed} disputed · {a.contracts.draft} draft · {a.contracts.cancelled} cancelled</p>
            <h2 className="mt-8 font-medium">Top providers</h2>
            {a.top_providers.length === 0 ? <p className="mt-2 text-sm">No contracts in this window.</p> : (
              <table className="mt-2 w-full max-w-2xl text-sm">
                <caption className="sr-only">Providers you contracted most in this window</caption>
                <thead><tr><th scope="col" className={th}>Provider</th><th scope="col" className={th}>Contracts</th><th scope="col" className={th}>Committed</th></tr></thead>
                <tbody>
                  {a.top_providers.map((p, i) => (
                    <tr key={`${i}-${p.name}-${p.currency}`} className="border-t border-neutral-200 dark:border-neutral-800">
                      <th scope="row" className={`${td} font-medium`}>{p.name}</th><td className={td}>{p.contracts}</td><td className={td}>{formatMinor(p.committed, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h2 className="mt-8 font-medium">Talent pools and invitations</h2>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Pools" value={a.talent.pools} hint={`${a.talent.pooled} professionals still public`} />
              <Tile label="Invitations sent" value={a.talent.invites_sent} hint={`${a.talent.invites_declined} declined`} />
              <Tile label="Invited who proposed" value={a.talent.proposals_from_invited} />
              <Tile label="Invitation to proposal" value={formatPct(a.talent.invite_to_proposal_pct)} />
            </dl>
            <h2 className="mt-8 font-medium">By month (UTC)</h2>
            {a.monthly.every((m) => m.projects === 0 && m.contracts === 0) ? <p className="mt-2 text-sm">Nothing posted or hired in this window.</p> : (
              <table className="mt-2 w-full max-w-md text-sm">
                <caption className="sr-only">Projects posted and contracts created per month</caption>
                <thead><tr><th scope="col" className={th}>Month</th><th scope="col" className={th}>Projects posted</th><th scope="col" className={th}>Contracts created</th></tr></thead>
                <tbody>
                  {a.monthly.map((m) => (
                    <tr key={m.month} className="border-t border-neutral-200 dark:border-neutral-800"><th scope="row" className={`${td} font-medium`}>{m.month}</th><td className={td}>{m.projects}</td><td className={td}>{m.contracts}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <h2 className="mt-8 font-medium">What these numbers mean</h2>
            <dl className="mt-2 max-w-3xl space-y-1 text-sm">
              {DEFINITIONS.map((d) => <div key={d.term}><dt className="inline font-medium">{d.term}: </dt><dd className="inline">{d.text}</dd></div>)}
            </dl>
          </>
        );
      })()}
    </AppShell>
  );
}

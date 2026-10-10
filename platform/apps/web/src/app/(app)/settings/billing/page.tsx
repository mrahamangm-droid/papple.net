import { AppShell } from "@/components/shell/AppShell";
import { ChoosePlanButton, ManageBillingButton } from "@/components/billing/BillingButtons";
import { requireCapability } from "@/lib/auth-context";
import { describeSubscription, planPriceLine } from "@/lib/billing/present";
import { settings } from "@/lib/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

/** Which plan audiences an organization type may buy. Agencies can step up to Enterprise; enterprise organizations buy it directly. */
const audiencesFor = (type: string): string[] =>
  type === "client_company" ? ["client"] : type === "individual" ? ["professional"] : type === "agency" ? ["professional", "agency", "enterprise"]
    : type === "enterprise" ? ["enterprise"] : [];

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const ctx = await requireCapability("org.read");
  const { checkout } = await searchParams;
  const db = await createServerSupabase();
  const owned = ctx.memberships.filter((m) => m.role === "owner").map((m) => m.orgId);
  const [{ data: orgs }, { data: plans }, { data: subs }] = await Promise.all([
    owned.length ? db.from("organizations").select("id, name, type").in("id", owned) : Promise.resolve({ data: [] }),
    db.from("plans").select("key, name, audience, price_cents, currency, interval, active").eq("active", true).order("sort"),
    owned.length ? db.from("subscriptions").select("org_id, plan_key, status, current_period_end, cancel_at_period_end, past_due_since").in("org_id", owned) : Promise.resolve({ data: [] }),
  ]);
  const subByOrg = new Map((subs ?? []).map((s) => [s.org_id as string, s]));
  const effective = await Promise.all((orgs ?? []).map(async (o) => {
    const { data } = await db.rpc("org_plan_key", { p_org: o.id as string });
    return [o.id as string, (data as string | null) ?? "free"] as const;
  }));
  const planOf = new Map(effective);
  const now = new Date();
  const graceDays = await settings.getSetting("billing.grace_days", z.number().int().min(0).max(30)).catch(() => 7);
  const trialDays = await settings.getSetting("billing.trial_days", z.number().int().min(0).max(90)).catch(() => 30);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-2 max-w-2xl text-sm">Plans are billed by Stripe. Papple never sees your card. Only the owner of an organization can change its plan.</p>
      {checkout === "success" && <p role="status" className="mt-4 rounded-md border border-green-600 p-3 text-sm">Thank you. Your plan updates as soon as Stripe confirms the payment, usually within a minute. Refresh this page to see it.</p>}
      {checkout === "cancelled" && <p role="status" className="mt-4 rounded-md border border-neutral-400 p-3 text-sm">Checkout was cancelled. Nothing was charged.</p>}
      <ul className="mt-6 space-y-6">
        {(orgs ?? []).map((o) => {
          const s = subByOrg.get(o.id as string);
          const current = planOf.get(o.id as string) ?? "free";
          const options = (plans ?? []).filter((p) => (p.price_cents as number | null) && audiencesFor(o.type as string).includes(p.audience as string));
          return (
            <li key={o.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="font-medium">{o.name as string} <span className="text-xs opacity-70">current plan: {current}</span></h2>
              <p className="mt-1 text-sm opacity-80">{describeSubscription(s ? { status: s.status as string, periodEnd: s.current_period_end as string | null, cancelAtPeriodEnd: s.cancel_at_period_end as boolean, pastDueSince: s.past_due_since as string | null } : null, now, graceDays)}</p>
              {s && <div className="mt-3"><ManageBillingButton orgId={o.id as string} /></div>}
              {!s || s.status === "canceled" || s.status === "incomplete_expired" ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {options.map((p) => (
                    <li key={p.key as string} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                      <p className="font-medium">{p.name as string}</p>
                      {/* one trial per organization: the server gives none once any subscription existed */}
                      <p className="text-sm opacity-80">{planPriceLine({ price_cents: p.price_cents as number, currency: p.currency as string, interval: (p.interval as string | null) ?? null }, s ? 0 : trialDays)}</p>
                      <div className="mt-2"><ChoosePlanButton orgId={o.id as string} planKey={p.key as string} label={`Choose ${p.name as string}`} /></div>
                    </li>
                  ))}
                  {options.length === 0 && <li className="text-sm">No paid plans are available for this organization yet.</li>}
                </ul>
              ) : null}
            </li>
          );
        })}
        {(orgs ?? []).length === 0 && <li className="text-sm">You do not own an organization. Ask an owner to manage billing.</li>}
      </ul>
    </AppShell>
  );
}

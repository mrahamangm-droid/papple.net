import { AppShell } from "@/components/shell/AppShell";
import { PayoutButton } from "@/components/contracts/ContractButtons";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function Payouts() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const managed = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.orgId);
  const { data: orgs } = managed.length ? await db.from("organizations").select("id, name, type").in("id", managed) : { data: [] };
  const payable = (orgs ?? []).filter((o) => o.type === "individual" || o.type === "agency");
  const { data: accounts } = payable.length ? await db.from("connected_accounts").select("org_id, payouts_enabled, details_submitted").in("org_id", payable.map((o) => o.id as string)) : { data: [] };
  const status = new Map((accounts ?? []).map((a) => [a.org_id as string, a]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Payouts</h1>
      <p className="mt-2 max-w-2xl text-sm">Professionals are paid through Stripe. Papple never holds your money; each milestone payment goes straight to your own payout account.</p>
      <ul className="mt-6 space-y-4">
        {payable.map((o) => {
          const a = status.get(o.id as string);
          const ready = a?.payouts_enabled === true;
          return (
            <li key={o.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="font-medium">{o.name as string}</p>
              <p className="text-sm opacity-80">{ready ? "Payouts are enabled. You can start contracts." : a ? "Setup is not finished yet." : "Not set up yet."}</p>
              {!ready && <div className="mt-3"><PayoutButton orgId={o.id as string} label={a ? "Continue payout setup" : "Set up payouts"} /></div>}
            </li>
          );
        })}
        {payable.length === 0 && <li className="text-sm">Only organizations that offer services (individual or agency) receive payouts, and only owners and admins manage them.</li>}
      </ul>
    </AppShell>
  );
}

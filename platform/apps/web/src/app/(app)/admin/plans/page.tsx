import { AppShell } from "@/components/shell/AppShell";
import { PlanForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const { data } = await db.from("plans").select("key, name, audience, price_cents, currency, interval, limits, features, active").order("sort");
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Plans</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Edit names, prices, limits and features. Plans cannot be created or deleted here, and the audience, interval, currency and Stripe price are not editable. Changing a price here does not change the Stripe price.</p>
      <ul className="mt-6 space-y-4">
        {(data ?? []).map((p) => (
          <li key={p.key as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="font-medium">{p.key as string} <span className="text-xs opacity-70">({p.audience as string}, {p.currency as string}{p.interval ? `/${p.interval}` : ""})</span></h2>
            <PlanForm plan={{ key: p.key as string, name: p.name as string, price_cents: p.price_cents as number | null, active: p.active as boolean, limits: p.limits, features: p.features }} />
          </li>
        ))}
      </ul>
    </AppShell>
  );
}

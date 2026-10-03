import { AppShell } from "@/components/shell/AppShell";
import { OrgStatusForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const ctx = await requireCapability("platform.admin");
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80).replace(/[%_\\,()]/g, " ") ?? "";
  const db = await createServerSupabase();
  let query = db.from("organizations").select("id, name, type, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data } = await query;
  const ids = (data ?? []).map((o) => o.id as string);
  const { data: subs } = ids.length ? await db.from("subscriptions").select("org_id, plan_key, status").in("org_id", ids) : { data: [] };
  const subByOrg = new Map((subs ?? []).map((s) => [s.org_id as string, s]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Organizations</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Suspending an organization removes it from public listings and stops its members using it. Counterparties keep access to shared contracts, and payments already in flight are still recorded.</p>
      <form method="get" className="mt-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name" className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm" />
        <button className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Search</button>
      </form>
      <ul className="mt-6 space-y-4">
        {(data ?? []).map((o) => (
          <li key={o.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{o.name as string} <span className="text-xs opacity-70">{o.type as string} · {o.status as string}</span></p>
            <p className="text-xs opacity-70">{subByOrg.get(o.id as string) ? `Subscription: ${subByOrg.get(o.id as string)!.plan_key as string} (${subByOrg.get(o.id as string)!.status as string})` : "No subscription (Free)"}</p>
            {(o.status === "active" || o.status === "suspended") && <OrgStatusForm orgId={o.id as string} name={o.name as string} status={o.status as "active" | "suspended"} />}
          </li>
        ))}
        {(data ?? []).length === 0 && <li className="text-sm">No organizations found.</li>}
      </ul>
    </AppShell>
  );
}

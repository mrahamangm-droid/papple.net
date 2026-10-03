import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { ServiceForm } from "@/components/marketplace/ServiceForm";
import { requireCapability } from "@/lib/auth-context";
import { eligibleOrgs } from "@/lib/marketplace/page-data";
import { priceLabel } from "@/lib/marketplace/present";
import { aiEnabledFor, publicCategories } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "My services" };
export const dynamic = "force-dynamic";

export default async function ServicesPage({ searchParams }: PageProps<"/services">) {
  const ctx = await requireCapability("org.read");
  const orgs = await eligibleOrgs(ctx, ["owner", "admin"]);
  const q = (await searchParams).org;
  const chosen = orgs.length === 1 ? orgs[0] : orgs.find((o) => o.id === (Array.isArray(q) ? q[0] : q));
  if (!chosen) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">My services</h1>
        {orgs.length === 0
          ? <Card className="mt-6"><p className="text-sm">Only an owner or admin of an organization can manage its services.</p></Card>
          : <ul className="mt-6 space-y-2">{orgs.map((o) => <li key={o.id}><Link className="underline" href={`/services?org=${o.id}`}>Manage services for {o.name}</Link></li>)}</ul>}
      </AppShell>
    );
  }
  const db = await createServerSupabase();
  const [{ data: list }, categories] = await Promise.all([
    db.from("services").select("id, slug, title, status, pricing_model, price_min, currency").eq("org_id", chosen.id).order("created_at", { ascending: false }),
    publicCategories(),
  ]);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Services for {chosen.name}</h1>
      <p className="mt-1 text-sm">You need a saved profile before a service can appear publicly.</p>
      <ul className="mt-6 space-y-2">
        {(list ?? []).map((s) => (
          <li key={s.id} className="text-sm">
            <span className="font-medium">{s.title}</span> · {s.status} · {priceLabel(s as { pricing_model: string; price_min: number | null; currency: string })}
            {s.status === "published" && <> · <Link className="underline" href={`/services/${s.slug}`}>view</Link></>}
          </li>
        ))}
        {(list ?? []).length === 0 && <li className="text-sm">No services yet.</li>}
      </ul>
      <h2 className="mt-10 text-lg font-semibold">Add a service</h2>
      <div className="mt-3 max-w-2xl"><ServiceForm orgId={chosen.id} categories={categories} aiOn={await aiEnabledFor(chosen.id)} /></div>
    </AppShell>
  );
}

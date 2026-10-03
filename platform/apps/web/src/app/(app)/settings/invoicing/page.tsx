import { AppShell } from "@/components/shell/AppShell";
import { BillingProfileForm } from "@/components/invoices/InvoiceButtons";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Invoicing" };
export const dynamic = "force-dynamic";

export default async function InvoicingPage() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const managed = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.orgId);
  const [{ data: orgs }, { data: profiles }] = await Promise.all([
    managed.length ? db.from("organizations").select("id, name").in("id", managed) : Promise.resolve({ data: [] }),
    managed.length ? db.from("billing_profiles").select("org_id, legal_name, address, country, tax_number, tax_bps").in("org_id", managed) : Promise.resolve({ data: [] }),
  ]);
  const byOrg = new Map((profiles ?? []).map((p) => [p.org_id as string, p]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Invoicing</h1>
      <p className="mt-2 max-w-2xl text-sm">These details appear on the invoices you issue for paid milestones. Clients can also save details so their name and tax number appear as the invoice recipient.</p>
      <ul className="mt-6 space-y-6">
        {(orgs ?? []).map((o) => {
          const p = byOrg.get(o.id as string);
          return (
            <li key={o.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="font-medium">{o.name as string}</h2>
              <BillingProfileForm orgId={o.id as string} defaults={{
                legalName: (p?.legal_name as string) ?? "", address: (p?.address as string) ?? "", country: (p?.country as string) ?? "",
                taxNumber: (p?.tax_number as string | null) ?? "", taxPercent: p ? String((p.tax_bps as number) / 100) : "0",
              }} />
            </li>
          );
        })}
        {(orgs ?? []).length === 0 && <li className="text-sm">Only owners and admins can manage invoicing details.</li>}
      </ul>
    </AppShell>
  );
}

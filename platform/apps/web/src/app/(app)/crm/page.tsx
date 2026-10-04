import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { AddContactForm, ImportContactsForm } from "@/components/crm/CrmForms";
import { requireCapability } from "@/lib/auth-context";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "member"];

/** Keep only characters that are safe inside a PostgREST `or` filter value. */
const safeTerm = (q: string) => q.replace(/[^\p{L}\p{N}@.\- ]/gu, "").trim().slice(0, 60);

export default async function CrmPage({ searchParams }: PageProps<"/crm">) {
  const ctx = await requireCapability("org.read");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const wanted = one(sp.org);
  const membership = ctx.memberships.find((m) => m.orgId === wanted && isValidUuid(wanted)) ?? ctx.memberships[0];
  if (!membership) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="mt-2 text-sm">Join or create an organization to keep contacts.</p>
      </AppShell>
    );
  }
  const q = safeTerm(one(sp.q));
  const db = await createServerSupabase();
  let query = db.from("crm_contacts").select("id, name, company, email, source", { count: "exact" }).eq("org_id", membership.orgId).order("name").limit(200);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`);
  const [{ data: contacts, count }, { data: orgs }] = await Promise.all([
    query,
    db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId)),
  ]);
  const canWrite = WRITERS.includes(membership.role);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">CRM</h1>
      <p className="mt-2 max-w-2xl text-sm">Contacts, deals and notes belong to your organization. Only its members can see them here; Papple staff can access them only to provide support.</p>
      {ctx.memberships.length > 1 && (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {(orgs ?? []).map((o) => (
            <Link key={o.id as string} className={o.id === membership.orgId ? "font-semibold underline" : "underline"} href={`/crm?org=${o.id as string}`}>{o.name as string}</Link>
          ))}
        </p>
      )}
      <form className="mt-6 flex max-w-xl gap-2" action="/crm" role="search">
        <input type="hidden" name="org" value={membership.orgId} />
        <input name="q" defaultValue={q} aria-label="Search contacts" placeholder="Search name, company or email" maxLength={60} className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2" />
        <button className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Search</button>
      </form>
      <h2 className="mt-6 text-lg font-semibold">Contacts ({count ?? 0})</h2>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {(contacts ?? []).map((c) => (
          <li key={c.id as string} className="py-2">
            <Link className="underline" href={`/crm/${c.id as string}?org=${membership.orgId}`}>{c.name as string}</Link>
            <span className="ml-2 text-sm opacity-70">{[c.company, c.email].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
        {(contacts ?? []).length === 0 && <li className="py-2 text-sm">{q ? "No contacts match that search." : "No contacts yet."}</li>}
      </ul>
      {canWrite ? (
        <>
          <h2 className="mt-8 text-lg font-semibold">Add a contact</h2>
          <AddContactForm orgId={membership.orgId} />
          <h2 className="mt-8 text-lg font-semibold">Import from a CSV file</h2>
          <ImportContactsForm orgId={membership.orgId} />
        </>
      ) : (
        <p className="mt-6 text-sm">Your role can view contacts but not change them.</p>
      )}
    </AppShell>
  );
}

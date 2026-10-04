import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { CreatePoolForm } from "@/components/talent/TalentForms";
import { requireCapability } from "@/lib/auth-context";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Talent pools" };
export const dynamic = "force-dynamic";

const ELIGIBLE = ["client_company", "enterprise", "agency"];

export default async function TalentPage({ searchParams }: PageProps<"/talent">) {
  const ctx = await requireCapability("org.read");
  const sp = await searchParams;
  const wanted = (Array.isArray(sp.org) ? sp.org[0] : sp.org) ?? "";
  const db = await createServerSupabase();
  const { data: orgs } = await db.from("organizations").select("id, name, type, status").in("id", ctx.memberships.map((m) => m.orgId));
  const eligible = (orgs ?? []).filter((o) => ELIGIBLE.includes(o.type as string) && o.status === "active");
  const org = eligible.find((o) => o.id === wanted && isValidUuid(wanted)) ?? eligible[0];
  if (!org) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">Talent pools</h1>
        <p className="mt-2 max-w-2xl text-sm">Talent pools are for client, agency and enterprise organizations that hire professionals. Individual provider accounts receive invitations instead; see Invitations.</p>
      </AppShell>
    );
  }
  const role = ctx.memberships.find((m) => m.orgId === org.id)?.role;
  const canManage = role === "owner" || role === "admin";
  const { data: pools, error } = await db.rpc("pools_overview", { p_org: org.id });
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Talent pools</h1>
      <p className="mt-2 max-w-2xl text-sm">Keep private shortlists of professionals you trust. Pools, notes and tags are visible only to {org.name as string}; professionals never see which pools they are in. Invite someone from a pool to one of your open projects.</p>
      {eligible.length > 1 && (
        <nav aria-label="Organization" className="mt-4 flex flex-wrap gap-2 text-sm">
          {eligible.map((o) => <Link key={o.id as string} href={`/talent?org=${o.id as string}`} aria-current={o.id === org.id ? "page" : undefined} className={`rounded-md border px-3 py-1 ${o.id === org.id ? "border-blue-600 font-medium" : "border-neutral-400"}`}>{o.name as string}</Link>)}
        </nav>
      )}
      {error && <p role="alert" className="mt-4 text-sm">Pools could not be loaded. Please refresh.</p>}
      <ul className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {((pools ?? []) as { id: string; name: string; description: string; members: number }[]).map((p) => (
          <li key={p.id} className="p-4">
            <Link href={`/talent/${p.id}?org=${org.id as string}`} className="font-medium underline">{p.name}</Link>
            <span className="ml-2 text-sm opacity-70">{Number(p.members)} {Number(p.members) === 1 ? "professional" : "professionals"}</span>
            {p.description && <p className="mt-1 text-sm">{p.description}</p>}
          </li>
        ))}
        {(pools ?? []).length === 0 && !error && <li className="p-4 text-sm">No pools yet.</li>}
      </ul>
      {canManage ? (
        <section className="mt-8">
          <h2 className="font-medium">Create a pool</h2>
          <CreatePoolForm orgId={org.id as string} />
        </section>
      ) : (
        <p className="mt-6 text-sm">Only owners and admins can create pools.</p>
      )}
    </AppShell>
  );
}

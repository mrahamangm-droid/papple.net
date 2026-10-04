import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { DeclineInvitationButton } from "@/components/talent/TalentForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";
import { inviteStatusLabel } from "@/lib/talent/present";

export const metadata = { title: "Invitations" };
export const dynamic = "force-dynamic";

interface Row { id: string; project_id: string; project_title: string; from_org: string; message: string; status: string; created_at: string }

export default async function InvitationsPage() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const [{ data: orgs }, { data: profiles }] = await Promise.all([
    db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId)),
    db.from("provider_profiles").select("org_id").in("org_id", ctx.memberships.map((m) => m.orgId)),
  ]);
  const withProfile = new Set((profiles ?? []).map((p) => p.org_id as string));
  const readers = new Set(ctx.memberships.filter((m) => m.role !== "viewer").map((m) => m.orgId));
  const mine = (orgs ?? []).filter((o) => withProfile.has(o.id as string) && readers.has(o.id as string));
  const results = await Promise.all(mine.map(async (o) => ({ org: o, ...(await db.rpc("my_invitations", { p_org: o.id })) })));
    return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Invitations</h1>
      <p className="mt-2 max-w-2xl text-sm">Organizations can invite you to an open project. An invitation is not a contract: if you are interested, send a proposal from the project page. Declining only closes this invitation.</p>
      {mine.length === 0 && <p className="mt-6 text-sm">Create a provider profile to receive invitations.</p>}
      {results.map(({ org, data, error }) => (
        <section key={org.id as string} className="mt-6">
          {mine.length > 1 && <h2 className="font-medium">{org.name as string}</h2>}
          {error && <p role="alert" className="mt-2 text-sm">Invitations could not be loaded. Please refresh.</p>}
          <ul className="mt-2 space-y-4">
            {((data ?? []) as Row[]).map((r) => (
              <li key={r.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <p className="font-medium">{r.from_org} invited you to <Link href={`/projects/${r.project_id}`} className="underline">{r.project_title}</Link></p>
                <p className="mt-1 whitespace-pre-line text-sm">{r.message}</p>
                <p className="mt-2 text-sm opacity-80">{inviteStatusLabel(r.status)}</p>
                {r.status === "sent" && <div className="mt-2"><DeclineInvitationButton orgId={org.id as string} id={r.id} title={r.project_title} /></div>}
              </li>
            ))}
            {(data ?? []).length === 0 && !error && <li className="text-sm">No open invitations.</li>}
          </ul>
        </section>
      ))}
    </AppShell>
  );
}

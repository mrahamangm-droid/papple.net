import { AppShell } from "@/components/shell/AppShell";
import { CredentialForm, DeleteCredentialButton, RequestCheckForm } from "@/components/marketplace/CredentialForms";
import { requireCapability } from "@/lib/auth-context";
import { CHECKED_COPY, kindLabel, ownerStatusLabel } from "@/lib/credentials/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Credentials" };
export const dynamic = "force-dynamic";

interface Row { id: string; org_id: string; kind: string; title: string; issuer: string; identifier: string | null; issued_on: string | null; expires_on: string | null; evidence_url: string | null; status: string; review_note: string | null }

export default async function CredentialsPage() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const managed = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.orgId);
  const [{ data: orgs }, { data: profiles }, { data: creds }] = await Promise.all([
    managed.length ? db.from("organizations").select("id, name").in("id", managed) : Promise.resolve({ data: [] }),
    managed.length ? db.from("provider_profiles").select("org_id, slug").in("org_id", managed) : Promise.resolve({ data: [] }),
    managed.length ? db.from("provider_credentials").select("id, org_id, kind, title, issuer, identifier, issued_on, expires_on, evidence_url, status, review_note").in("org_id", managed).order("created_at") : Promise.resolve({ data: [] }),
  ]);
  const hasProfile = new Set((profiles ?? []).map((p) => p.org_id as string));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="mt-2 max-w-2xl text-sm">List your licences, degrees and certifications on your public profile. Everything starts as self-declared. Add an evidence link or number and request a check, and a PAPple reviewer will look at it. {CHECKED_COPY}</p>
      <ul className="mt-6 space-y-8">
        {(orgs ?? []).map((o) => {
          const mine = ((creds ?? []) as Row[]).filter((c) => c.org_id === o.id);
          return (
            <li key={o.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="font-medium">{o.name as string}</h2>
              {!hasProfile.has(o.id as string) ? (
                <p className="mt-2 text-sm">Create a provider profile first; credentials appear on it.</p>
              ) : (
                <>
                  <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
                    {mine.map((c) => (
                      <li key={c.id} className="py-3 text-sm">
                        <p className="font-medium">{c.title} <span className="font-normal opacity-70">{kindLabel(c.kind)} · {c.issuer}</span></p>
                        <p className="mt-1">{ownerStatusLabel(c.status)}</p>
                        {c.status === "rejected" && c.review_note && <p className="mt-1 opacity-80">Reviewer note: {c.review_note}</p>}
                        <details className="mt-2">
                          <summary className="cursor-pointer underline">Edit</summary>
                          <CredentialForm orgId={o.id as string} initial={{ id: c.id, kind: c.kind, title: c.title, issuer: c.issuer, identifier: c.identifier ?? "", issuedOn: c.issued_on ?? "", expiresOn: c.expires_on ?? "", evidenceUrl: c.evidence_url ?? "" }} />
                        </details>
                        {c.status === "declared" && (c.evidence_url || c.identifier) && <RequestCheckForm orgId={o.id as string} id={c.id} />}
                        <div className="mt-2"><DeleteCredentialButton orgId={o.id as string} id={c.id} title={c.title} /></div>
                      </li>
                    ))}
                    {mine.length === 0 && <li className="py-3 text-sm">No credentials yet.</li>}
                  </ul>
                  <h3 className="mt-4 font-medium">Add a credential</h3>
                  <CredentialForm orgId={o.id as string} />
                </>
              )}
            </li>
          );
        })}
        {(orgs ?? []).length === 0 && <li className="text-sm">Only owners and admins can manage credentials.</li>}
      </ul>
    </AppShell>
  );
}

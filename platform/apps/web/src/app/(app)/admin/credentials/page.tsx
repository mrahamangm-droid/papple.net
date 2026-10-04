import { AppShell } from "@/components/shell/AppShell";
import { CredentialReviewForm, CredentialRevokeForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { kindLabel } from "@/lib/credentials/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Credential checks" };
export const dynamic = "force-dynamic";

const nameOf = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? "Organization";

export default async function CredentialQueue() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const cols = "id, version, kind, title, issuer, identifier, issued_on, expires_on, evidence_url, request_note, updated_at, organizations(name)";
  const [{ data: pending }, { data: checked }] = await Promise.all([
    db.from("provider_credentials").select(cols).eq("status", "pending").order("updated_at").limit(100),
    db.from("provider_credentials").select(cols).eq("status", "checked").order("reviewed_at", { ascending: false }).limit(100),
  ]);
  const Details = ({ c }: { c: Record<string, unknown> }) => (
    <>
      <p className="font-medium">{c.title as string} <span className="text-xs opacity-70">{kindLabel(c.kind as string)} · {c.issuer as string} · {nameOf(c.organizations)}</span></p>
      <p className="mt-1 text-sm">Number: <code>{(c.identifier as string | null) ?? "none"}</code> · Issued {(c.issued_on as string | null) ?? "unknown"} · Expires {(c.expires_on as string | null) ?? "no expiry"}</p>
      {c.evidence_url ? <p className="mt-1 break-all text-sm">Evidence link: <code>{c.evidence_url as string}</code></p> : null}
    </>
  );
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Credential checks</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Approving means Papple reviewed the evidence supplied. It is not a certification of the credential, the issuer or the person. Evidence links are shown as text; open them with care.</p>
      <h2 className="mt-8 text-xl font-semibold">Pending</h2>
      <ul className="mt-3 space-y-4">
        {(pending ?? []).map((c) => (
          <li key={c.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <Details c={c as Record<string, unknown>} />
            <p className="mt-1 whitespace-pre-line text-sm">Note from the organization: {c.request_note as string}</p>
            <div className="mt-3"><CredentialReviewForm credentialId={c.id as string} version={c.version as number} /></div>
          </li>
        ))}
        {(pending ?? []).length === 0 && <li className="text-sm">No pending checks.</li>}
      </ul>
      <h2 className="mt-10 text-xl font-semibold">Checked credentials</h2>
      <ul className="mt-3 space-y-4">
        {(checked ?? []).map((c) => (
          <li key={c.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <Details c={c as Record<string, unknown>} />
            <div className="mt-3"><CredentialRevokeForm credentialId={c.id as string} /></div>
          </li>
        ))}
        {(checked ?? []).length === 0 && <li className="text-sm">None yet.</li>}
      </ul>
    </AppShell>
  );
}

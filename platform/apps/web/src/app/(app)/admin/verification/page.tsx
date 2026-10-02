import { AppShell } from "@/components/shell/AppShell";
import { ReviewForm, RevokeForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

export default async function VerificationQueue() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const [{ data: pending }, { data: verified }] = await Promise.all([
    db.from("verification_requests").select("id, org_id, evidence_note, evidence_url, created_at, organizations(name)").eq("status", "pending").order("created_at").limit(100),
    db.from("provider_profiles").select("org_id, slug, verified_at, organizations(name)").not("verified_at", "is", null).order("verified_at", { ascending: false }).limit(100),
  ]);
  const nameOf = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? "Organization";
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Verification</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Approving means Papple reviewed the evidence supplied. It is not a licence or credential check. Evidence links are shown as text; open them with care.</p>
      <h2 className="mt-8 text-xl font-semibold">Pending requests</h2>
      <ul className="mt-3 space-y-4">
        {(pending ?? []).map((r) => (
          <li key={r.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{nameOf(r.organizations)} <span className="text-xs opacity-70">requested {(r.created_at as string).slice(0, 10)}</span></p>
            <p className="mt-1 whitespace-pre-line text-sm">{r.evidence_note as string}</p>
            {r.evidence_url && <p className="mt-1 break-all text-sm">Evidence link: <code>{r.evidence_url as string}</code></p>}
            <div className="mt-3"><ReviewForm requestId={r.id as string} /></div>
          </li>
        ))}
        {(pending ?? []).length === 0 && <li className="text-sm">No pending requests.</li>}
      </ul>
      <h2 className="mt-10 text-xl font-semibold">Verified providers</h2>
      <ul className="mt-3 space-y-4">
        {(verified ?? []).map((v) => (
          <li key={v.org_id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{nameOf(v.organizations)} <span className="text-xs opacity-70">since {(v.verified_at as string).slice(0, 10)}</span></p>
            <RevokeForm orgId={v.org_id as string} />
          </li>
        ))}
        {(verified ?? []).length === 0 && <li className="text-sm">No verified providers yet.</li>}
      </ul>
    </AppShell>
  );
}

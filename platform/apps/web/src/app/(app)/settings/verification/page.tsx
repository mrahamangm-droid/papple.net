import { AppShell } from "@/components/shell/AppShell";
import { RequestVerificationForm } from "@/components/admin/ConsoleForms";
import { VERIFIED_COPY } from "@/lib/admin/present";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

export default async function VerificationSettings() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const managed = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.orgId);
  const { data: profiles } = managed.length ? await db.from("provider_profiles").select("org_id, verified_at, status, organizations(name)").in("org_id", managed) : { data: [] };
  const { data: reqs } = managed.length ? await db.from("verification_requests").select("org_id, status, review_note, created_at").in("org_id", managed).order("created_at", { ascending: false }) : { data: [] };
  const latest = new Map<string, { status: string; review_note: string | null }>();
  for (const r of reqs ?? []) if (!latest.has(r.org_id as string)) latest.set(r.org_id as string, r as { status: string; review_note: string | null });
  const nameOf = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? "Organization";
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Verification</h1>
      <p className="mt-2 max-w-2xl text-sm">{VERIFIED_COPY}</p>
      <ul className="mt-6 space-y-4">
        {(profiles ?? []).map((p) => {
          const l = latest.get(p.org_id as string);
          return (
            <li key={p.org_id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="font-medium">{nameOf(p.organizations)}</p>
              {p.verified_at ? <p className="text-sm">Verified since {(p.verified_at as string).slice(0, 10)}.</p>
                : l?.status === "pending" ? <p className="text-sm">Your request is waiting for review.</p>
                : p.status !== "active" ? <p className="text-sm">Your profile is not active, so it cannot be verified right now.</p>
                : <>
                    {l?.status === "rejected" && <p className="mb-2 text-sm">Your last request was not approved{l.review_note ? `: ${l.review_note}` : "."} You can send a new one.</p>}
                    <RequestVerificationForm orgId={p.org_id as string} />
                  </>}
            </li>
          );
        })}
        {(profiles ?? []).length === 0 && <li className="text-sm">Create a public provider profile first, then you can ask for verification here.</li>}
      </ul>
    </AppShell>
  );
}

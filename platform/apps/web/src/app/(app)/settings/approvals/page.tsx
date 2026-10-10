import { AppShell } from "@/components/shell/AppShell";
import { PolicyForm } from "@/components/approvals/ApprovalForms";
import { pickOrg } from "@/lib/approvals/org";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { isManager, policySummary, type SpendPolicy } from "@/lib/approvals/present";
import { requireCapability } from "@/lib/auth-context";
import { fromMinor } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Approvals settings" };
export const dynamic = "force-dynamic";

export default async function ApprovalSettingsPage({ searchParams }: PageProps<"/settings/approvals">) {
  const ctx = await requireCapability("org.read");
  const membership = pickOrg(ctx.memberships, (await searchParams).org, isManager);
  const manager = membership && isManager(membership);
  const db = await createServerSupabase();
  const { data: orgRows } = await db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId));
  const orgs = (orgRows ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  const { data: policy } = manager
    ? await db.from("spend_policies").select("enabled, threshold_minor, currency").eq("org_id", membership.orgId).maybeSingle()
    : { data: null };
  const p = policy as SpendPolicy | null;
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Contract approvals</h1>
      {membership && <OrgSwitcher orgId={membership.orgId} orgs={orgs} />}
      {!manager ? (
        <p className="mt-4 text-sm">Only owners and admins can see the approval rule.</p>
      ) : (
        <>
          <p className="mt-3 max-w-2xl text-sm">{policySummary(p)}</p>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">Owners always accept directly. The rule applies when your organization is the client. Requests are listed under <a className="underline" href={`/approvals?org=${membership.orgId}`}>Approvals</a>.</p>
          {membership.role === "owner" ? (
            <PolicyForm orgId={membership.orgId} enabled={p?.enabled ?? true}
              amount={p ? String(fromMinor(p.threshold_minor, p.currency)) : ""} currency={p?.currency ?? "USD"} />
          ) : (
            <p className="mt-4 text-sm">Only owners can change this rule.</p>
          )}
        </>
      )}
    </AppShell>
  );
}

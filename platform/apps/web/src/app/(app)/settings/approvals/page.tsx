import { AppShell } from "@/components/shell/AppShell";
import { PolicyForm, TierForm } from "@/components/approvals/ApprovalForms";
import { pickOrg } from "@/lib/approvals/org";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { isManager, policySummary, tierSummary, type SpendPolicy, type SpendTier } from "@/lib/approvals/present";
import { requireCapability } from "@/lib/auth-context";
import { BudgetForm } from "@/components/budgets/BudgetForm";
import { BudgetMeter } from "@/components/budgets/BudgetMeter";
import { loadBudgetStatus } from "@/lib/budgets/load";
import { budgetSummary, type BudgetSetting } from "@/lib/budgets/present";
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
  const [{ data: tierRows }, { data: team }] = manager
    ? await Promise.all([
        db.from("spend_tiers").select("min_minor, approvals").eq("org_id", membership.orgId).order("min_minor"),
        db.rpc("team_members", { p_org: membership.orgId }),
      ])
    : [{ data: null }, { data: null }];
  const tiers = (tierRows ?? []) as SpendTier[];
  const owners = ((team ?? []) as { role: string }[]).filter((m) => m.role === "owner").length;
  const [{ data: budget }, status] = manager
    ? await Promise.all([
        db.from("budgets").select("enabled, period, amount_minor, currency").eq("org_id", membership.orgId).maybeSingle(),
        loadBudgetStatus(db, membership.orgId),
      ])
    : [{ data: null }, null];
  const b = budget as BudgetSetting | null;
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
          {p?.enabled && (
            <>
              <h2 className="mt-10 text-lg font-medium">How many owners must approve</h2>
              <p className="mt-2 max-w-2xl text-sm">{tierSummary(tiers, p.currency)}</p>
              {membership.role === "owner"
                ? <TierForm orgId={membership.orgId} currency={p.currency} owners={owners}
                    tiers={tiers.map((t) => ({ min: String(fromMinor(t.min_minor, p.currency)), approvals: t.approvals }))} />
                : <p className="mt-2 text-sm">Only owners can change the tiers.</p>}
            </>
          )}
          <h2 className="mt-10 text-lg font-medium">Budget</h2>
          <p className="mt-2 max-w-2xl text-sm">{budgetSummary(b)}</p>
          <BudgetMeter status={status} />
          {membership.role === "owner" ? (
            <BudgetForm orgId={membership.orgId} enabled={b?.enabled ?? true} period={b?.period === "month" ? "month" : "quarter"}
              amount={b ? String(fromMinor(b.amount_minor, b.currency)) : ""} currency={b?.currency ?? p?.currency ?? "USD"} />
          ) : (
            <p className="mt-4 text-sm">Only owners can change the budget.</p>
          )}
        </>
      )}
    </AppShell>
  );
}

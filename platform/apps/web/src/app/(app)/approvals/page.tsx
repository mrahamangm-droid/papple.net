import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { DecideButtons, WithdrawButton } from "@/components/approvals/ApprovalForms";
import { pickOrg } from "@/lib/approvals/org";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { canDecide, canWithdraw, isManager, requestStatusLabel } from "@/lib/approvals/present";
import { requireCapability } from "@/lib/auth-context";
import { formatMinor } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

interface Row { id: string; contract_id: string; requested_by: string | null; status: string; price: number; currency: string; note: string; created_at: string; decided_at: string | null; contracts: { title: string } | null }
const COLS = "id, contract_id, requested_by, status, price, currency, note, created_at, decided_at, contracts(title)";

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const ctx = await requireCapability("org.read");
  const membership = pickOrg(ctx.memberships, (await searchParams).org, isManager);
  const db = await createServerSupabase();
  const { data: orgRows } = await db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId));
  const orgs = (orgRows ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  if (!membership || !isManager(membership)) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        {membership && <OrgSwitcher orgId={membership.orgId} orgs={orgs} />}
        <p className="mt-4 text-sm">Only owners and admins can see approvals.</p>
      </AppShell>
    );
  }
  const orgId = membership.orgId, role = membership.role;
  const [{ data: pending }, { data: decided }, { data: members }] = await Promise.all([
    db.from("spend_requests").select(COLS).eq("org_id", orgId).eq("status", "pending").order("created_at", { ascending: true }),
    db.from("spend_requests").select(COLS).eq("org_id", orgId).neq("status", "pending").order("created_at", { ascending: false }).limit(50),
    db.rpc("team_members", { p_org: orgId }),
  ]);
  const names = new Map(((members ?? []) as { user_id: string; email: string; display_name: string | null }[]).map((m) => [m.user_id, m.display_name || m.email]));
  const who = (id: string | null) => (id === ctx.userId ? "you" : (id && names.get(id)) || "a former member");
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB");
  const title = (r: Row) => <Link className="underline" href={`/contracts/${r.contract_id}`}>{r.contracts?.title ?? "Contract"}</Link>;
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <OrgSwitcher orgId={orgId} orgs={orgs} />
      <p className="mt-2 max-w-2xl text-sm">Contracts an admin accepted that need an owner&apos;s approval under your <Link className="underline" href={`/settings/approvals?org=${orgId}`}>approval rule</Link>.</p>

      <h2 className="mt-8 text-lg font-medium">Waiting</h2>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {((pending ?? []) as unknown as Row[]).map((r) => (
          <li key={r.id} className="space-y-2 py-3 text-sm">
            <p>{title(r)}: <strong>{formatMinor(r.price, r.currency)}</strong>, requested by {who(r.requested_by)} on {day(r.created_at)}</p>
            <div className="flex flex-wrap gap-4">
              {canDecide(role, r.requested_by, ctx.userId) && <DecideButtons orgId={orgId} requestId={r.id} contractId={r.contract_id} />}
              {canWithdraw(role, r.requested_by, ctx.userId) && <WithdrawButton orgId={orgId} requestId={r.id} contractId={r.contract_id} />}
            </div>
            {!canDecide(role, r.requested_by, ctx.userId) && <p className="text-neutral-600 dark:text-neutral-400">{role === "owner" ? "Another owner must decide your own request." : "Waiting for an owner."}</p>}
          </li>
        ))}
        {(pending ?? []).length === 0 && <li className="py-3 text-sm">Nothing is waiting.</li>}
      </ul>

      <h2 className="mt-8 text-lg font-medium">Recent decisions</h2>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {((decided ?? []) as unknown as Row[]).map((r) => (
          <li key={r.id} className="py-3 text-sm">
            {title(r)}: {formatMinor(r.price, r.currency)}, {requestStatusLabel(r.status).toLowerCase()}{r.decided_at ? ` on ${day(r.decided_at)}` : ""}, requested by {who(r.requested_by)}
            {r.note && <span className="block text-neutral-600 dark:text-neutral-400">Reason: {r.note}</span>}
          </li>
        ))}
        {(decided ?? []).length === 0 && <li className="py-3 text-sm">No decisions yet.</li>}
      </ul>
    </AppShell>
  );
}

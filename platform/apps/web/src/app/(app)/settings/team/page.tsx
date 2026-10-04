import { AppShell } from "@/components/shell/AppShell";
import { InviteForm, LeaveButton, RemoveMemberButton, RevokeInviteButton, RoleSelect } from "@/components/team/TeamForms";
import { requireCapability } from "@/lib/auth-context";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";
import { canChangeMember, canInvite, canRemoveMember, roleLabel, ROLE_HELP, seatSummary, type TeamRole } from "@/lib/team/present";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

interface Member { user_id: string; email: string; display_name: string | null; role: string; joined_at: string }
interface Usage { members: number; pending: number; limit: number | null }

export default async function TeamPage({ searchParams }: PageProps<"/settings/team">) {
  const ctx = await requireCapability("org.read");
  const sp = await searchParams;
  const wanted = (Array.isArray(sp.org) ? sp.org[0] : sp.org) ?? "";
  const membership = ctx.memberships.find((m) => m.orgId === wanted && isValidUuid(wanted)) ?? ctx.memberships[0]!;
  const orgId = membership.orgId, caller = membership.role;
  const db = await createServerSupabase();
  const [{ data: members }, { data: usage }, { data: orgs }, invites] = await Promise.all([
    db.rpc("team_members", { p_org: orgId }),
    db.rpc("team_seat_usage", { p_org: orgId }),
    db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId)),
    canInvite(caller)
      ? db.from("org_invites").select("id, email, role, created_at, expires_at").eq("org_id", orgId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; created_at: string; expires_at: string }[] }),
  ]);
  const rows = (members ?? []) as Member[];
  const orgName = (orgs ?? []).find((o) => o.id === orgId)?.name as string | undefined;
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Team</h1>
      {ctx.memberships.length > 1 && (
        <form className="mt-3 flex items-end gap-2 text-sm" method="get">
          <label>Organization
            <select name="org" defaultValue={orgId} className="ml-2 rounded-md border border-neutral-300 bg-transparent px-2 py-1">
              {(orgs ?? []).map((o) => <option key={o.id as string} value={o.id as string}>{o.name as string}</option>)}
            </select>
          </label>
          <button className="rounded-md border border-neutral-400 px-3 py-1">Switch</button>
        </form>
      )}
      <p className="mt-2 max-w-2xl text-sm">People in <strong>{orgName ?? "this organization"}</strong>. You are {roleLabel(caller).toLowerCase()}. {usage ? seatSummary(usage as Usage) : ""}</p>

      <h2 className="mt-8 text-lg font-medium">Members</h2>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map((m) => {
          const self = m.user_id === ctx.userId;
          const roles = canChangeMember(caller, m.role, self);
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-0 flex-1"><span className="font-medium">{m.display_name || m.email}</span>{self && " (you)"}<br /><span className="text-neutral-600 dark:text-neutral-400">{m.email}</span></span>
              {roles.length > 0 ? <RoleSelect orgId={orgId} userId={m.user_id} role={m.role} options={roles} self={self} /> : <span>{roleLabel(m.role)}</span>}
              {canRemoveMember(caller, m.role, self) && <RemoveMemberButton orgId={orgId} userId={m.user_id} label={m.display_name || m.email} />}
            </li>
          );
        })}
      </ul>

      {canInvite(caller) && (
        <>
          <h2 className="mt-8 text-lg font-medium">Invite someone</h2>
          <p className="mt-1 max-w-2xl text-sm">They join only by signing in with the address you enter and accepting. Invites expire after 7 days.</p>
          <InviteForm orgId={orgId} callerRole={caller} />
          <h3 className="mt-6 font-medium">Pending invites</h3>
          <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
            {(invites.data ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="flex-1">{i.email} as {roleLabel(i.role).toLowerCase()}, expires {new Date(i.expires_at).toLocaleDateString("en-GB")}</span>
                {(caller === "owner" || i.role !== "admin") && <RevokeInviteButton orgId={orgId} inviteId={i.id} />}
              </li>
            ))}
            {(invites.data ?? []).length === 0 && <li className="py-3 text-sm">No pending invites.</li>}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-lg font-medium">Roles</h2>
      <dl className="mt-2 max-w-2xl space-y-1 text-sm">
        {(["owner", "admin", "member", "viewer"] as TeamRole[]).map((r) => <div key={r}><dt className="inline font-medium">{roleLabel(r)}: </dt><dd className="inline">{ROLE_HELP[r]}</dd></div>)}
      </dl>
      <p className="mt-3 max-w-2xl text-sm">To hand over ownership, make the other person an owner, then change your own role.</p>

      <h2 className="mt-8 text-lg font-medium">Leave</h2>
      <LeaveButton orgId={orgId} />
    </AppShell>
  );
}

import { AppShell } from "@/components/shell/AppShell";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { CancelBookingButton, DecideBookingButtons } from "@/components/bookings/BookingForms";
import { LocalTime } from "@/components/bookings/LocalTime";
import { pickOrg } from "@/lib/approvals/org";
import { requireCapability } from "@/lib/auth-context";
import { bookingStatusLabel } from "@/lib/bookings/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

interface Row { id: string; side: "provider" | "client"; service_title: string; other_org_name: string; starts_at: string; ends_at: string; status: string; note: string; meeting_url: string | null; reason: string; cancelled_by_org: string | null }

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const ctx = await requireCapability("org.read");
  const membership = pickOrg(ctx.memberships, (await searchParams).org);
  const db = await createServerSupabase();
  const { data: orgRows } = await db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId));
  const orgs = (orgRows ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  if (!membership) return <AppShell ctx={ctx}><h1 className="text-2xl font-semibold">Bookings</h1><p className="mt-4 text-sm">Join or create an organization to book or take bookings.</p></AppShell>;
  const orgId = membership.orgId, canAct = membership.role !== "viewer";
  const { data } = await db.rpc("booking_list", { p_org: orgId });
  const rows = (data ?? []) as Row[];
  const now = new Date();
  const live = (r: Row) => (r.status === "pending" || r.status === "confirmed") && new Date(r.starts_at) > now;
  const section = (title: string, side: Row["side"], empty: string) => {
    const mine = rows.filter((r) => r.side === side);
    const upcoming = mine.filter(live).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const past = mine.filter((r) => !live(r)).slice(0, 50);
    return (
      <section className="mt-8">
        <h2 className="text-lg font-medium">{title}</h2>
        <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
          {[...upcoming, ...past].map((r) => (
            <li key={r.id} className="space-y-2 py-3 text-sm">
              <p><strong>{r.service_title}</strong> with {r.other_org_name}: <LocalTime iso={r.starts_at} /> · {bookingStatusLabel(r.status, r.starts_at, now)}</p>
              {r.note && side === "provider" && <p className="text-neutral-600 dark:text-neutral-400">Note: {r.note}</p>}
              {r.reason && <p className="text-neutral-600 dark:text-neutral-400">Reason: {r.reason}</p>}
              {r.status === "confirmed" && r.meeting_url && live(r) && <p><a className="underline" href={r.meeting_url} rel="noopener noreferrer" target="_blank">Meeting link</a></p>}
              <div className="flex flex-wrap gap-3">
                {canAct && side === "provider" && r.status === "pending" && live(r) && <DecideBookingButtons orgId={orgId} bookingId={r.id} />}
                {r.status === "confirmed" && <a className="underline" href={`/api/bookings/${r.id}/ics?org=${orgId}`}>Add to calendar</a>}
                {canAct && live(r) && <CancelBookingButton orgId={orgId} bookingId={r.id} />}
              </div>
            </li>
          ))}
          {mine.length === 0 && <li className="py-3 text-sm">{empty}</li>}
        </ul>
      </section>
    );
  };
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Bookings</h1>
      <OrgSwitcher orgId={orgId} orgs={orgs} />
      <p className="mt-2 max-w-2xl text-sm">Times are shown in your own time zone. Professionals set their hours in <a className="underline" href={`/settings/bookings?org=${orgId}`}>Booking settings</a>.</p>
      {section("Requests to you", "provider", "No one has booked your services yet.")}
      {section("Your bookings", "client", "You have not booked anyone yet.")}
    </AppShell>
  );
}

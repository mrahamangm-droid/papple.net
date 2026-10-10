import { AppShell } from "@/components/shell/AppShell";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { z } from "zod";
import { CancelBookingButton, DecideBookingButtons, PayBookingButton, RetryRefundButton } from "@/components/bookings/BookingForms";
import { LocalTime } from "@/components/bookings/LocalTime";
import { pickOrg } from "@/lib/approvals/org";
import { requireCapability } from "@/lib/auth-context";
import { bookingPaymentState, bookingRefundRule, bookingStatusLabel, clientCancelForfeits } from "@/lib/bookings/present";
import { settings } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

interface Row { id: string; side: "provider" | "client"; service_title: string; other_org_name: string; starts_at: string; ends_at: string; status: string; note: string; meeting_url: string | null; reason: string; cancelled_by_org: string | null;
  price: number | null; currency: string | null; pay_by: string | null; payment_status: string | null; refund_status: string | null }

async function refundCutoffHours(): Promise<number> {
  try { return await settings.getSetting("bookings.client_refund_cutoff_hours", z.number().int().min(0).max(720)); } catch { return 24; }
}

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const ctx = await requireCapability("org.read");
  const params = await searchParams;
  const membership = pickOrg(ctx.memberships, params.org);
  const db = await createServerSupabase();
  const { data: orgRows } = await db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId));
  const orgs = (orgRows ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  if (!membership) return <AppShell ctx={ctx}><h1 className="text-2xl font-semibold">Bookings</h1><p className="mt-4 text-sm">Join or create an organization to book or take bookings.</p></AppShell>;
  const orgId = membership.orgId, canAct = membership.role !== "viewer";
  const { data } = await db.rpc("booking_list", { p_org: orgId });
  const rows = (data ?? []) as Row[];
  const now = new Date();
  const cutoff = await refundCutoffHours();
  const hasPaid = rows.some((r) => r.price != null);
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
              {(() => {
                const pay = bookingPaymentState(r, now);
                if (!pay) return null;
                return (
                  <p className="flex flex-wrap items-center gap-2">
                    <span>{pay.text}{pay.payBy && <> <LocalTime iso={pay.payBy} /></>}{pay.kind === "due" && side === "provider" ? " (the time is released if it is not paid)" : ""}</span>
                    {canAct && side === "client" && pay.kind === "due" && <PayBookingButton orgId={orgId} bookingId={r.id} />}
                    {canAct && pay.kind === "refund_pending" && <RetryRefundButton orgId={orgId} bookingId={r.id} />}
                  </p>
                );
              })()}
              {r.status === "confirmed" && r.meeting_url && live(r) && <p><a className="underline" href={r.meeting_url} rel="noopener noreferrer" target="_blank">Meeting link</a></p>}
              <div className="flex flex-wrap gap-3">
                {canAct && side === "provider" && r.status === "pending" && live(r) && <DecideBookingButtons orgId={orgId} bookingId={r.id} />}
                {r.status === "confirmed" && <a className="underline" href={`/api/bookings/${r.id}/ics?org=${orgId}`}>Add to calendar</a>}
                {canAct && live(r) && <CancelBookingButton orgId={orgId} bookingId={r.id}
                  warning={clientCancelForfeits(r, cutoff, now) ? "This booking is paid and starts soon: cancelling now is not refunded." : r.side === "provider" && r.payment_status === "succeeded" ? "The client is refunded in full." : undefined} />}
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
      {params.paid === "1" && <p role="status" className="mt-4 max-w-2xl rounded-md border border-neutral-300 p-3 text-sm">Thank you. Your payment is being confirmed; the booking shows as paid once the payment provider tells us, usually within a minute.</p>}
      <p className="mt-2 max-w-2xl text-sm">Times are shown in your own time zone. Professionals set their hours in <a className="underline" href={`/settings/bookings?org=${orgId}`}>Booking settings</a>.</p>
      {hasPaid && <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">Paid bookings: {bookingRefundRule(cutoff)}</p>}
      {section("Requests to you", "provider", "No one has booked your services yet.")}
      {section("Your bookings", "client", "You have not booked anyone yet.")}
    </AppShell>
  );
}

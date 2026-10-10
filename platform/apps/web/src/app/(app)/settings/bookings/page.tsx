import { AppShell } from "@/components/shell/AppShell";
import { OrgSwitcher } from "@/components/approvals/OrgSwitcher";
import { BookingSettingsForm, ServiceBookingSelect, ServicePriceInput, type Hours } from "@/components/bookings/BookingForms";
import { pickOrg } from "@/lib/approvals/org";
import { isManager } from "@/lib/approvals/present";
import { requireCapability } from "@/lib/auth-context";
import { fromMinor, minorExponent } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Booking settings" };
export const dynamic = "force-dynamic";

export default async function BookingSettingsPage({ searchParams }: PageProps<"/settings/bookings">) {
  const ctx = await requireCapability("org.read");
  const membership = pickOrg(ctx.memberships, (await searchParams).org, isManager);
  const db = await createServerSupabase();
  const { data: orgRows } = await db.from("organizations").select("id, name").in("id", ctx.memberships.map((m) => m.orgId));
  const orgs = (orgRows ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  if (!membership || !isManager(membership)) {
    return <AppShell ctx={ctx}><h1 className="text-2xl font-semibold">Booking settings</h1>{membership && <OrgSwitcher orgId={membership.orgId} orgs={orgs} />}<p className="mt-4 text-sm">Only owners and admins can change booking settings.</p></AppShell>;
  }
  const orgId = membership.orgId;
  const [{ data: settings }, { data: hours }, { data: services }, { data: payout }] = await Promise.all([
    db.from("booking_settings").select("enabled, timezone, buffer_minutes, min_notice_hours, horizon_days").eq("org_id", orgId).maybeSingle(),
    db.from("booking_hours").select("weekday, start_time, end_time").eq("org_id", orgId).order("weekday").order("start_time"),
    db.from("services").select("id, title, status, currency, booking_minutes, booking_price").eq("org_id", orgId).neq("status", "archived").order("title"),
    db.from("connected_accounts").select("payouts_enabled").eq("org_id", orgId).maybeSingle(),
  ]);
  const payoutsReady = (payout?.payouts_enabled as boolean | undefined) === true;
  const priceText = (minor: number | null, currency: string) => (minor == null ? "" : fromMinor(minor, currency).toFixed(minorExponent(currency)));
  const hhmm = (t: string) => t.slice(0, 5);
  const initialHours: Hours[] = (hours ?? []).map((h) => ({ weekday: h.weekday as number, start: hhmm(h.start_time as string), end: hhmm(h.end_time as string) }));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Booking settings</h1>
      <OrgSwitcher orgId={orgId} orgs={orgs} />
      <p className="mt-2 max-w-2xl text-sm">Clients book open times on your service pages and you confirm or decline each request. A service with a price is paid through Papple after you confirm: the client has a limited time to pay, Papple keeps its usual fee, and the rest is paid out to your account.</p>
      <BookingSettingsForm orgId={orgId} enabled={(settings?.enabled as boolean | undefined) ?? false} timezone={(settings?.timezone as string | undefined) ?? "UTC"}
        buffer={(settings?.buffer_minutes as number | undefined) ?? 0} notice={(settings?.min_notice_hours as number | undefined) ?? 12} horizon={(settings?.horizon_days as number | undefined) ?? 30}
        hours={initialHours.length ? initialHours : [{ weekday: 1, start: "09:00", end: "17:00" }]} />
      <h2 className="mt-8 text-lg font-medium">Services</h2>
      <p className="mt-1 text-sm">Choose a slot length to let clients book a service, and optionally a price per session (leave it empty for free). Only published services are shown to clients. A price change applies to new requests only.</p>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {(services ?? []).map((s) => (
          <li key={s.id as string} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>{s.title as string}{s.status !== "published" ? ` (${s.status as string})` : ""}</span>
            <span className="flex flex-wrap items-center gap-3">
              <ServiceBookingSelect orgId={orgId} serviceId={s.id as string} minutes={(s.booking_minutes as number | null) ?? null} />
              <ServicePriceInput orgId={orgId} serviceId={s.id as string} currency={s.currency as string} payoutsReady={payoutsReady}
                price={priceText((s.booking_price as number | null) ?? null, s.currency as string)} />
            </span>
          </li>
        ))}
        {(services ?? []).length === 0 && <li className="py-3 text-sm">No services yet.</li>}
      </ul>
    </AppShell>
  );
}

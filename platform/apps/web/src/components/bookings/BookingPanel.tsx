import { getAuthContext } from "@/lib/auth-context";
import { eligibleOrgs } from "@/lib/marketplace/page-data";
import { createServerSupabase } from "@/lib/supabase/server";
import { BookingPicker } from "./BookingPicker";

type View = { kind: "hidden" } | { kind: "signin" } | { kind: "picker"; minutes: number; orgs: { id: string; name: string }[] };

/** Loads what the panel needs. Any hiccup hides the panel, so a booking problem never breaks the public page. */
async function load(serviceId: string): Promise<View> {
  try {
    const db = await createServerSupabase();
    const { data: minutes } = await db.rpc("booking_offer", { p_service: serviceId });
    if (typeof minutes !== "number") return { kind: "hidden" };
    const ctx = await getAuthContext();
    if (!ctx) return { kind: "signin" };
    // the database refuses booking the professional's own organization, so no client-side guess is needed here
    const orgs = await eligibleOrgs(ctx, ["owner", "admin", "member"]);
    return { kind: "picker", minutes, orgs: orgs.map((o) => ({ id: o.id, name: o.name })) };
  } catch {
    return { kind: "hidden" };
  }
}

/** On a public service page: nothing unless the service takes bookings; a sign-in prompt for visitors; the picker otherwise. */
export async function BookingPanel({ serviceId, path }: { serviceId: string; path: string }) {
  const v = await load(serviceId);
  if (v.kind === "hidden") return null;
  if (v.kind === "signin") return <p className="mt-10 text-sm"><a href={`/signin?next=${encodeURIComponent(path)}`} className="underline">Sign in to book a time</a></p>;
  return (
    <section aria-label="Book a time" className="mt-10">
      <h2 className="text-lg font-semibold">Book a time</h2>
      {v.orgs.length === 0
        ? <p className="mt-2 text-sm">Booking needs an organization you can act for (owner, admin or member).</p>
        : <BookingPicker serviceId={serviceId} minutes={v.minutes} orgs={v.orgs} />}
    </section>
  );
}

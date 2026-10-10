"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { bookingSlotsAction, requestBookingAction } from "@/app/(app)/booking-actions";
import { bookingFailureMessage, groupSlotsByDay, type BookingFailure } from "@/lib/bookings/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const DAYS = 14;

/** Free slots for the next two weeks, shown in the viewer's own time zone. */
export function BookingPicker({ serviceId, minutes, orgs, priceLine, refundRule }: {
  serviceId: string; minutes: number; orgs: { id: string; name: string }[]; priceLine?: string | null; refundRule?: string | null;
}) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const load = () => start(async () => {
    setError("");
    const from = new Date(), to = new Date(from.getTime() + DAYS * 86400_000);
    const r = await bookingSlotsAction({ serviceId, from: from.toISOString(), to: to.toISOString() });
    if (r.ok) setSlots(r.slots); else { setSlots([]); setError(bookingFailureMessage(r.code)); }
  });
  useEffect(load, [serviceId]);

  const days = groupSlotsByDay(slots ?? [], tz);
  if (done) {
    return (
      <p role="status" className="mt-3 text-sm">
        Request sent. The professional will confirm or decline it; you will get a notification.
        {priceLine ? " Once it is confirmed, pay from Bookings to keep the time." : ""} See <a className="underline" href="/bookings">Bookings</a>.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{minutes}-minute slots, shown in your time zone ({tz}).</p>
      {priceLine && <p className="text-sm"><strong>{priceLine}</strong>{refundRule ? ` ${refundRule}` : ""}</p>}
      {slots === null && <p className="text-sm">Loading open times…</p>}
      {slots !== null && days.length === 0 && !error && <p className="text-sm">No open times in the next two weeks.</p>}
      <div className="space-y-3">
        {days.map((d) => (
          <div key={d.day}>
            <p className="text-sm font-medium">{d.label}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {d.slots.map((s) => (
                <button key={s.iso} type="button" aria-pressed={chosen === s.iso} onClick={() => setChosen(s.iso)}
                  className={`${btn} ${chosen === s.iso ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}>{s.time}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {chosen && (
        <form className="max-w-md space-y-2" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError("");
            const r = await requestBookingAction({ orgId, serviceId, start: chosen, note });
            if (r.ok) { setDone(true); return; }
            setError(bookingFailureMessage(r.code as BookingFailure));
            if (r.code === "taken") { setChosen(null); load(); }
          });
        }}>
          {orgs.length > 1 && (
            <label className="block text-sm">Book for
              <select className="ml-2 rounded-md border border-neutral-300 bg-transparent px-2 py-1" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm">Note for the professional (optional)
            <textarea className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button disabled={pending} className={btn}>Request this time</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

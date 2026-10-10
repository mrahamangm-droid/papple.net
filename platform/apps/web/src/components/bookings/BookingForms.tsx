"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  cancelBookingAction, decideBookingAction, payBookingAction, retryBookingRefundAction, saveBookingSettingsAction, setServiceBookingAction, setServicePriceAction,
} from "@/app/(app)/booking-actions";
import { bookingFailureMessage, type BookingFailure } from "@/lib/bookings/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Result = { ok: true } | { ok: false; code: BookingFailure };

function useBookingAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<Result>, onOk?: () => void) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); return; }
      setError(bookingFailureMessage(r.code));
      if (r.code === "refund_failed") router.refresh(); // the cancellation itself went through
    } catch { setError(bookingFailureMessage("error")); }
  });
  return { pending, error, run };
}

export interface Hours { weekday: number; start: string; end: string }
export function BookingSettingsForm(p: { orgId: string; enabled: boolean; timezone: string; buffer: number; notice: number; horizon: number; hours: Hours[] }) {
  const { pending, error, run } = useBookingAction();
  const [enabled, setEnabled] = useState(p.enabled);
  const [timezone, setTimezone] = useState(p.timezone);
  const [buffer, setBuffer] = useState(p.buffer);
  const [notice, setNotice] = useState(p.notice);
  const [horizon, setHorizon] = useState(p.horizon);
  const [hours, setHours] = useState<Hours[]>(p.hours);
  const [saved, setSaved] = useState(false);
  const set = (i: number, h: Partial<Hours>) => setHours(hours.map((x, j) => (j === i ? { ...x, ...h } : x)));
  return (
    <form className="mt-3 max-w-2xl space-y-4" onSubmit={(e) => {
      e.preventDefault(); setSaved(false);
      run(() => saveBookingSettingsAction({ orgId: p.orgId, enabled, timezone: timezone.trim(), bufferMinutes: buffer, noticeHours: notice, horizonDays: horizon, hours }), () => setSaved(true));
    }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Take bookings</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Time zone (for example Europe/London)<input className={field} required value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
        <label className="text-sm">Gap after each call (minutes)<input className={field} type="number" min={0} max={120} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} /></label>
        <label className="text-sm">Minimum notice (hours)<input className={field} type="number" min={0} max={720} value={notice} onChange={(e) => setNotice(Number(e.target.value))} /></label>
        <label className="text-sm">Book up to (days ahead)<input className={field} type="number" min={1} max={90} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} /></label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Weekly hours</legend>
        {hours.map((h, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <select aria-label="Day" className="rounded-md border border-neutral-300 bg-transparent px-2 py-1" value={h.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
              {DAYS.map((d, k) => <option key={d} value={k + 1}>{d}</option>)}
            </select>
            <input aria-label="From" type="time" className="rounded-md border border-neutral-300 bg-transparent px-2 py-1" value={h.start} onChange={(e) => set(i, { start: e.target.value })} />
            <span>to</span>
            <input aria-label="Until" type="time" className="rounded-md border border-neutral-300 bg-transparent px-2 py-1" value={h.end} onChange={(e) => set(i, { end: e.target.value })} />
            <button type="button" className={btn} onClick={() => setHours(hours.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {hours.length < 21 && <button type="button" className={btn} onClick={() => setHours([...hours, { weekday: 1, start: "09:00", end: "17:00" }])}>Add hours</button>}
      </fieldset>
      <button disabled={pending} className={btn}>Save</button>
      {saved && <p role="status" className="text-sm">Saved.</p>}
      <Err error={error} />
    </form>
  );
}

export function ServiceBookingSelect({ orgId, serviceId, minutes }: { orgId: string; serviceId: string; minutes: number | null }) {
  const { pending, error, run } = useBookingAction();
  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label="Slot length" disabled={pending} defaultValue={minutes ?? ""} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
        onChange={(e) => run(() => setServiceBookingAction({ orgId, serviceId, minutes: e.target.value === "" ? null : Number(e.target.value) }))}>
        <option value="">Not bookable</option>
        {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
      </select>
      <Err error={error} />
    </span>
  );
}

export function DecideBookingButtons({ orgId, bookingId }: { orgId: string; bookingId: string }) {
  const { pending, error, run } = useBookingAction();
  const [url, setUrl] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Meeting link (optional)<input className={field} type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <button disabled={pending} className={btn} onClick={() => run(() => decideBookingAction({ orgId, bookingId, confirm: true, meetingUrl: url, reason: "" }))}>Confirm</button>
        {!declining && <button disabled={pending} className={btn} onClick={() => setDeclining(true)}>Decline…</button>}
      </div>
      {declining && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => decideBookingAction({ orgId, bookingId, confirm: false, meetingUrl: "", reason })); }}>
          <label className="text-sm">Reason (optional)<input className={field} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button disabled={pending} className={btn}>Decline request</button>
        </form>
      )}
      <Err error={error} />
    </div>
  );
}

export function CancelBookingButton({ orgId, bookingId, warning }: { orgId: string; bookingId: string; warning?: string }) {
  const { pending, error, run } = useBookingAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className={btn} onClick={() => setOpen(true)}>Cancel…</button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => cancelBookingAction({ orgId, bookingId, reason })); }}>
      {warning && <p className="w-full text-sm text-amber-800 dark:text-amber-300">{warning}</p>}
      <label className="text-sm">Reason (shown to the other side)<input className={field} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button disabled={pending || !reason.trim()} className={btn}>Cancel booking</button>
      <Err error={error} />
    </form>
  );
}

/** Price per session in major units; empty means free. Charging needs finished payout setup. */
export function ServicePriceInput({ orgId, serviceId, price, currency, payoutsReady }: { orgId: string; serviceId: string; price: string; currency: string; payoutsReady: boolean }) {
  const { pending, error, run } = useBookingAction();
  const [value, setValue] = useState(price);
  const [saved, setSaved] = useState(false);
  if (!payoutsReady && !price) return <a className="text-sm underline" href={`/settings/payouts?org=${orgId}`}>Finish payout setup to charge</a>;
  return (
    <form className="inline-flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSaved(false); run(() => setServicePriceAction({ orgId, serviceId, price: value, currency }), () => setSaved(true)); }}>
      <label className="text-sm">Price ({currency})
        <input aria-label="Price per session" inputMode="decimal" placeholder="Free" className="ml-2 w-24 rounded-md border border-neutral-300 bg-transparent px-2 py-1"
          value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
      </label>
      <button disabled={pending} className={btn}>Save price</button>
      {saved && <span role="status" className="text-sm">Saved.</span>}
      <Err error={error} />
    </form>
  );
}

/** Opens Stripe Checkout for a confirmed booking. The database decides the amount; the webhook marks it paid. */
export function PayBookingButton({ orgId, bookingId }: { orgId: string; bookingId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button disabled={pending} className={btn} onClick={() => start(async () => {
        setError("");
        try {
          const r = await payBookingAction({ orgId, bookingId });
          if (r.ok) window.location.assign(r.url); else setError(bookingFailureMessage(r.code));
        } catch { setError(bookingFailureMessage("error")); }
      })}>Pay now</button>
      <Err error={error} />
    </span>
  );
}

export function RetryRefundButton({ orgId, bookingId }: { orgId: string; bookingId: string }) {
  const { pending, error, run } = useBookingAction();
  const [sent, setSent] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button disabled={pending} className={btn} onClick={() => run(() => retryBookingRefundAction({ orgId, bookingId }), () => setSent(true))}>Retry refund</button>
      {sent && <span role="status" className="text-sm">Sent. It shows as refunded once the payment provider confirms.</span>}
      <Err error={error} />
    </span>
  );
}

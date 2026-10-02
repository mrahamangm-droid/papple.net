"use client";
import posthog from "posthog-js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createConsent } from "@/lib/consent";

const EVENT = "papple-consent-change";
// Lazy accessors: nothing touches `window` during server rendering.
const lazyStorage = {
  getItem: (k: string) => window.localStorage.getItem(k),
  setItem: (k: string, v: string) => window.localStorage.setItem(k, v),
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export function ConsentBanner() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const consent = useMemo(
    () => createConsent({
      storage: lazyStorage,
      initAnalytics: () => {
        if (key) posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com", persistence: "localStorage", capture_pageview: true });
      },
    }),
    [key],
  );
  // Server snapshot is "granted" so the banner never flashes into server-rendered HTML.
  const value = useSyncExternalStore(subscribe, () => consent.get(), () => "granted" as const);

  useEffect(() => { consent.startIfGranted(); }, [consent, value]);

  if (!key || value !== "unset") return null;
  const choose = (v: "granted" | "denied") => { consent.set(v); window.dispatchEvent(new Event(EVENT)); };
  return (
    <div role="dialog" aria-label="Analytics consent" className="fixed inset-x-0 bottom-0 border-t border-neutral-300 bg-white p-4 text-sm text-neutral-900 shadow-lg">
      <p className="mx-auto max-w-3xl">We use privacy-respecting analytics to improve Papple, only with your permission.</p>
      <div className="mx-auto mt-3 flex max-w-3xl gap-3">
        <button onClick={() => choose("granted")} className="rounded-md bg-neutral-900 px-4 py-2 text-white">Allow analytics</button>
        <button onClick={() => choose("denied")} className="rounded-md border border-neutral-400 px-4 py-2">No thanks</button>
      </div>
    </div>
  );
}

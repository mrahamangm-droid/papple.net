"use client";
import { useState, useTransition } from "react";
import { toMinor } from "@/lib/marketplace/present";
import type { ActionResult } from "@/lib/marketplace/actions";
import { messageFor } from "@/lib/marketplace/result-messages";

/** Runs a server action with pending and error state. Success calls onOk; failures show calm copy only. */
export function useAction(onOk?: (r: Extract<ActionResult, { ok: true }>) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (r.ok) onOk?.(r); else setError(messageFor(r));
    });
  return { pending, error, run };
}

export function FormError({ error }: { error: string }) {
  return error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null;
}

export const fieldClass = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";

/** Form value helpers: empty string -> undefined, number fields -> integers (money is converted with the currency's own exponent). */
export const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? undefined : v; };
export const int = (f: FormData, k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
export const money = (f: FormData, k: string, currency: string) => { const v = str(f, k); return v === undefined ? undefined : toMinor(Number(v), currency); };
export const cur = (f: FormData) => (str(f, "currency") ?? "USD").toUpperCase();

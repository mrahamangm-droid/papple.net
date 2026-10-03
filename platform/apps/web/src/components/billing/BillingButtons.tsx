"use client";
import { useState, useTransition } from "react";
import { openPortalAction, startCheckoutAction } from "@/app/(app)/billing-actions";
import type { BillingResult } from "@/lib/billing/service";
import { billingMessage } from "@/lib/billing/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";

function useBillingAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<BillingResult>) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) window.location.assign(r.url); else setError(billingMessage(r.code));
    } catch {
      setError(billingMessage("error"));
    }
  });
  return { pending, error, run };
}

export function ChoosePlanButton({ orgId, planKey, label }: { orgId: string; planKey: string; label: string }) {
  const { pending, error, run } = useBillingAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => startCheckoutAction({ orgId, planKey }))} className={btn}>{label}</button>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function ManageBillingButton({ orgId }: { orgId: string }) {
  const { pending, error, run } = useBillingAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => openPortalAction({ orgId }))} className={btn}>Manage billing</button>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

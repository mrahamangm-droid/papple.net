"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { issueCreditNoteAction, issueInvoiceAction, saveBillingProfileAction } from "@/app/(app)/invoice-actions";
import { invoiceFailureMessage } from "@/lib/invoices/present";
import type { InvoiceFailure } from "@/lib/invoices/service";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";

function useInvoiceAction(onOk: () => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ ok: true } | { ok: false; code: InvoiceFailure }>) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) onOk(); else setError(invoiceFailureMessage(r.code));
    } catch {
      setError(invoiceFailureMessage("error"));
    }
  });
  return { pending, error, run };
}

const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

export function IssueInvoiceButton({ orgId, contractId, milestoneId }: { orgId: string; contractId: string; milestoneId: string }) {
  const router = useRouter();
  const { pending, error, run } = useInvoiceAction(() => router.refresh());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => issueInvoiceAction({ orgId, contractId, milestoneId }))} className={btn}>Issue invoice</button>
      <Err error={error} />
    </div>
  );
}

export function IssueCreditNoteButton({ orgId, contractId, invoiceId }: { orgId: string; contractId: string; invoiceId: string }) {
  const router = useRouter();
  const { pending, error, run } = useInvoiceAction(() => router.refresh());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => issueCreditNoteAction({ orgId, contractId, invoiceId }))} className={btn}>Issue credit note</button>
      <Err error={error} />
    </div>
  );
}

export interface ProfileDefaults { legalName: string; address: string; country: string; taxNumber: string; taxPercent: string }

export function BillingProfileForm({ orgId, defaults }: { orgId: string; defaults: ProfileDefaults }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useInvoiceAction(() => { setSaved(true); router.refresh(); });
  return (
    <form className="mt-3 max-w-xl space-y-3" onSubmit={(e) => {
      e.preventDefault();
      setSaved(false);
      const f = new FormData(e.currentTarget);
      run(() => saveBillingProfileAction({
        orgId, legalName: String(f.get("legalName") ?? ""), address: String(f.get("address") ?? ""), country: String(f.get("country") ?? ""),
        taxNumber: String(f.get("taxNumber") ?? ""), taxPercent: Number(String(f.get("taxPercent") ?? "0") || "0"),
      }));
    }}>
      <label className="block text-sm">Legal name<input name="legalName" required minLength={2} maxLength={160} defaultValue={defaults.legalName} className={field} /></label>
      <label className="block text-sm">Address<textarea name="address" required minLength={5} maxLength={500} rows={3} defaultValue={defaults.address} className={field} /></label>
      <label className="block text-sm">Country (2-letter code, e.g. AE)<input name="country" required minLength={2} maxLength={2} defaultValue={defaults.country} className={field} /></label>
      <label className="block text-sm">Tax registration number (required if you charge tax)<input name="taxNumber" maxLength={40} defaultValue={defaults.taxNumber} className={field} /></label>
      <label className="block text-sm">Tax rate in percent (0 if you do not charge tax)<input name="taxPercent" type="number" min={0} max={100} step="0.01" defaultValue={defaults.taxPercent} className={field} /></label>
      <p className="text-xs opacity-70">The milestone price your client pays is treated as the tax-inclusive total. Papple does not calculate or file tax for you.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>Save billing details</button>
        {saved && !error && <span role="status" className="text-sm">Saved. New invoices use these details; issued invoices never change.</span>}
        <Err error={error} />
      </div>
    </form>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postReviewAction, raiseDisputeAction, setMilestonesAction } from "@/app/(app)/contract-actions";
import { FormError, fieldClass } from "@/components/marketplace/useAction";
import { fromMinor, toMinor } from "@/lib/marketplace/present";
import { btn, useContractAction } from "./useContractAction";

interface Draft { title: string; description: string; amount: string; dueDate: string }
export interface InitialMilestone { title: string; description: string; amount: number; due_date: string | null }

/** Editable milestone list for a draft contract. Amounts are typed in major units and converted with the currency's own exponent. */
export function MilestoneEditor({ orgId, contractId, currency, price, initial }: { orgId: string; contractId: string; currency: string; price: number; initial: InitialMilestone[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(initial.length ? initial.map((m) => ({ title: m.title, description: m.description, amount: String(fromMinor(m.amount, currency)), dueDate: m.due_date ?? "" })) : [{ title: "", description: "", amount: "", dueDate: "" }]);
  const { pending, error, run } = useContractAction(() => router.refresh());
  const minor = rows.map((r) => (r.amount.trim() === "" || Number.isNaN(Number(r.amount)) ? 0 : toMinor(Number(r.amount), currency)));
  const total = minor.reduce((a, b) => a + b, 0);
  const set = (i: number, patch: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => setMilestonesAction({ orgId, contractId, items: rows.map((r, i) => ({ title: r.title, description: r.description, amount: minor[i], ...(r.dueDate ? { dueDate: r.dueDate } : {}) })) })); }}
      className="space-y-4"
    >
      {rows.map((r, i) => (
        <fieldset key={i} className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <legend className="px-1 text-sm">Milestone {i + 1}</legend>
          <label className="block text-sm">Title<input className={fieldClass} value={r.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={200} required /></label>
          <label className="block text-sm">Description<textarea className={fieldClass} value={r.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={2000} rows={2} /></label>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Amount ({currency})<input className={fieldClass} inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} required /></label>
            <label className="text-sm">Due date<input className={fieldClass} type="date" value={r.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} /></label>
          </div>
          {rows.length > 1 && <button type="button" className={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} onClick={() => setRows([...rows, { title: "", description: "", amount: "", dueDate: "" }])}>Add milestone</button>
        <button disabled={pending} className={btn}>Save milestones</button>
        <p role="status" className="text-sm">Total {fromMinor(total, currency)} of {fromMinor(price, currency)} {currency}{total === price ? " — matches the price" : " — must equal the contract price"}</p>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function DisputeForm({ orgId, contractId }: { orgId: string; contractId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const { pending, error, run } = useContractAction(() => { setReason(""); router.refresh(); });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (window.confirm("Raising a dispute freezes further payments on this contract. Continue?")) run(() => raiseDisputeAction({ orgId, contractId, reason })); }} className="space-y-2">
      <label className="block text-sm">Describe the problem
        <textarea className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} minLength={10} maxLength={2000} required />
      </label>
      <button disabled={pending || reason.trim().length < 10} className={btn}>Raise dispute</button>
      <FormError error={error} />
    </form>
  );
}

export function ReviewForm({ orgId, contractId }: { orgId: string; contractId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const { pending, error, run } = useContractAction(() => router.refresh());
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => postReviewAction({ orgId, contractId, rating, comment })); }} className="space-y-2">
      <label className="block text-sm">Rating
        <select className={fieldClass} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="block text-sm">Comment (optional)
        <textarea className={fieldClass} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <p className="text-xs opacity-70">Your review stays hidden until the other side reviews too, or the reveal window passes.</p>
      <button disabled={pending} className={btn}>Post review</button>
      <FormError error={error} />
    </form>
  );
}

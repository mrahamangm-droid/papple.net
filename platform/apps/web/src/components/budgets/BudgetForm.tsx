"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveBudgetAction } from "@/app/(app)/budget-actions";
import { approvalFailureMessage } from "@/lib/approvals/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";

export function BudgetForm(p: { orgId: string; enabled: boolean; period: "month" | "quarter"; amount: string; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(p.enabled);
  const [period, setPeriod] = useState(p.period);
  const [amount, setAmount] = useState(p.amount);
  const [currency, setCurrency] = useState(p.currency);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="mt-3 max-w-md space-y-3" onSubmit={(e) => {
      e.preventDefault(); setError(""); setSaved(false);
      start(async () => {
        try {
          const r = await saveBudgetAction({ orgId: p.orgId, enabled: on, period, amount, currency });
          if (r.ok) { setSaved(true); router.refresh(); } else setError(approvalFailureMessage(r.code));
        } catch { setError(approvalFailureMessage("error")); }
      });
    }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Use a budget</label>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Per
          <select className={field} value={period} onChange={(e) => setPeriod(e.target.value as "month" | "quarter")}>
            <option value="month">month</option><option value="quarter">quarter</option>
          </select>
        </label>
        <label className="flex-1 text-sm">Amount
          <input className={field} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000.00" />
        </label>
        <label className="w-28 text-sm">Currency
          <input className={field} required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
        </label>
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">Calendar months or quarters, in UTC. Accepted contracts count in full when accepted; paid bookings count when paid.</p>
      <button disabled={pending} className={btn}>Save budget</button>
      {saved && <p role="status" className="text-sm">Saved.</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </form>
  );
}

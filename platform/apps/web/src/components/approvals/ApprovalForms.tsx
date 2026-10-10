"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideSpendRequestAction, setSpendPolicyAction, setSpendTiersAction, withdrawSpendRequestAction } from "@/app/(app)/approvals-actions";
import { approvalFailureMessage, decideOutcomeMessage, type ApprovalFailure } from "@/lib/approvals/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

type Result = { ok: true; outcome?: string } | { ok: false; code: ApprovalFailure };

function useApprovalAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = (fn: () => Promise<Result>) => start(async () => {
    setError(""); setNotice("");
    try {
      const r = await fn();
      if (!r.ok) { setError(approvalFailureMessage(r.code)); return; }
      setNotice(decideOutcomeMessage(r.outcome) ?? "");
      router.refresh();
    } catch {
      setError(approvalFailureMessage("error"));
    }
  });
  return { pending, error, notice, run };
}

export function PolicyForm({ orgId, enabled, amount, currency }: { orgId: string; enabled: boolean; amount: string; currency: string }) {
  const { pending, error, run } = useApprovalAction();
  const [on, setOn] = useState(enabled);
  const [value, setValue] = useState(amount);
  const [cur, setCur] = useState(currency);
  return (
    <form className="mt-3 max-w-md space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => setSpendPolicyAction({ orgId, enabled: on, amount: value, currency: cur })); }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Require an owner&apos;s approval</label>
      <div className="flex gap-3">
        <label className="flex-1 text-sm">Amount (or more)
          <input className={field} inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} placeholder="1000.00" />
        </label>
        <label className="w-28 text-sm">Currency
          <input className={field} required maxLength={3} value={cur} onChange={(e) => setCur(e.target.value)} placeholder="USD" />
        </label>
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">Digits only, with an optional decimal point (for example 2500.50). Contracts in any other currency always need approval.</p>
      <button disabled={pending} className={btn}>Save rule</button>
      <Err error={error} />
    </form>
  );
}

export function DecideButtons({ orgId, requestId, contractId }: { orgId: string; requestId: string; contractId: string }) {
  const { pending, error, notice, run } = useApprovalAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button disabled={pending} className={btn} onClick={() => run(() => decideSpendRequestAction({ orgId, requestId, contractId, approve: true, note: "" }))}>Approve</button>
        {!rejecting && <button disabled={pending} className={btn} onClick={() => setRejecting(true)}>Reject…</button>}
      </div>
      {rejecting && (
        <form className="max-w-md space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => decideSpendRequestAction({ orgId, requestId, contractId, approve: false, note })); }}>
          <label className="block text-sm">Reason (shown to the admin)
            <textarea className={field} required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button disabled={pending || !note.trim()} className={btn}>Reject request</button>
        </form>
      )}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Err error={error} />
    </div>
  );
}

export function WithdrawButton({ orgId, requestId, contractId }: { orgId: string; requestId: string; contractId: string }) {
  const { pending, error, run } = useApprovalAction();
  return (
    <div>
      <button disabled={pending} className={btn} onClick={() => { if (window.confirm("Withdraw this approval request?")) run(() => withdrawSpendRequestAction({ orgId, requestId, contractId })); }}>Withdraw</button>
      <Err error={error} />
    </div>
  );
}

export interface TierRow { min: string; approvals: number }
/** Owners set how many different owners must approve from each amount (at most 3, never more than there are owners). */
export function TierForm({ orgId, currency, tiers, owners }: { orgId: string; currency: string; tiers: TierRow[]; owners: number }) {
  const { pending, error, notice, run } = useApprovalAction();
  const [rows, setRows] = useState<TierRow[]>(tiers);
  const [saved, setSaved] = useState(false);
  const set = (i: number, r: Partial<TierRow>) => { setSaved(false); setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x))); };
  const max = Math.max(1, Math.min(3, owners));
  return (
    <form className="mt-3 max-w-md space-y-3" onSubmit={(e) => {
      e.preventDefault(); setSaved(false);
      run(async () => { const r = await setSpendTiersAction({ orgId, currency, tiers: rows }); if (r.ok) setSaved(true); return r; });
    }}>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 text-sm">
          <label>From ({currency})<input className={field} inputMode="decimal" required value={r.min} onChange={(e) => set(i, { min: e.target.value })} placeholder="50000.00" /></label>
          <label>Owners needed
            <select className={field} value={r.approvals} onChange={(e) => set(i, { approvals: Number(e.target.value) })}>
              {[1, 2, 3].filter((n) => n <= max).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" className={btn} onClick={() => { setSaved(false); setRows(rows.filter((_, j) => j !== i)); }}>Remove</button>
        </div>
      ))}
      {rows.length < 10 && <button type="button" className={btn} onClick={() => { setSaved(false); setRows([...rows, { min: "", approvals: Math.min(2, max) }]); }}>Add tier</button>}
      <p className="text-xs text-neutral-600 dark:text-neutral-400">The highest tier a contract reaches decides how many different owners must approve it. In a tier of two or more, an owner&apos;s own accept counts as one approval.</p>
      <button disabled={pending} className={btn}>Save tiers</button>
      {saved && <p role="status" className="text-sm">Saved.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Err error={error} />
    </form>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryRefundsAction, ruleDisputeAction } from "@/app/(app)/admin/disputes/actions";
import { FormError, fieldClass } from "@/components/marketplace/useAction";
import type { DisputeActionResult } from "@/lib/disputes/actions";
import { OUTCOME_COPY } from "@/lib/disputes/present";
import type { Outcome } from "@/lib/disputes/validators";
import { messageFor } from "@/lib/marketplace/result-messages";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";

/** Runs an admin action; a thrown error (not signed in, not an admin, no second factor) becomes calm copy. */
function useDisputeAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = (fn: () => Promise<DisputeActionResult>) =>
    start(async () => {
      setError(""); setNotice("");
      try {
        const r = await fn();
        if (!r.ok) { setError(messageFor(r)); return; }
        if (r.retryNeeded) setNotice("The ruling is saved, but the refund could not be sent yet. Use Retry refunds.");
        else if (r.failed > 0) setNotice(`${r.failed} refund(s) could not be sent. Use Retry refunds.`);
        else if (r.issued > 0) setNotice(`${r.issued} refund(s) sent to Stripe. They finish when Stripe confirms.`);
        router.refresh();
      } catch {
        setError(messageFor({ ok: false, code: "forbidden" }));
      }
    });
  return { pending, error, notice, run };
}

export function RulingForm({ disputeId, choices }: { disputeId: string; choices: Outcome[] }) {
  const [outcome, setOutcome] = useState<Outcome>(choices[0]);
  const [note, setNote] = useState("");
  const { pending, error, notice, run } = useDisputeAction();
  const refund = outcome === "refund_cancel";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const msg = refund ? "This cancels the contract and refunds the client through Stripe. It cannot be undone. Continue?" : "Record this ruling? It cannot be undone.";
        if (window.confirm(msg)) run(() => ruleDisputeAction({ disputeId, outcome, note }));
      }}
      className="space-y-3"
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ruling</legend>
        {choices.map((c) => (
          <label key={c} className="block rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700">
            <input type="radio" name="outcome" className="mr-2" checked={outcome === c} onChange={() => setOutcome(c)} />
            <span className="font-medium">{OUTCOME_COPY[c].label}</span>
            <span className="mt-1 block opacity-80">{OUTCOME_COPY[c].help}</span>
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">Written reason (both parties are notified; at least 10 characters)
        <textarea className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} rows={4} minLength={10} maxLength={1000} required />
      </label>
      <button disabled={pending || note.trim().length < 10} className={btn}>{refund ? "Rule and refund" : "Record ruling"}</button>
      <FormError error={error} />
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

export function RetryRefunds({ disputeId }: { disputeId: string }) {
  const { pending, error, notice, run } = useDisputeAction();
  return (
    <div className="space-y-2">
      <button disabled={pending} className={btn} onClick={() => run(() => retryRefundsAction({ disputeId }))}>Retry refunds</button>
      <FormError error={error} />
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}

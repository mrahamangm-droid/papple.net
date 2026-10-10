"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  acceptContractAction, activateContractAction, approveAndPayAction, cancelContractAction, hireAction, requestChangesAction,
  startPayoutOnboardingAction, submitMilestoneAction,
} from "@/app/(app)/contract-actions";
import { FormError, fieldClass } from "@/components/marketplace/useAction";
import { acceptOutcomeMessage } from "@/lib/approvals/present";
import { btn, useContractAction } from "./useContractAction";

export function HireButton({ orgId, proposalId, projectId }: { orgId: string; proposalId: string; projectId: string }) {
  const router = useRouter();
  const { pending, error, run } = useContractAction((r) => { if (r.id) router.push(`/contracts/${r.id}`); });
  return (
    <div className="flex items-center gap-2">
      <button disabled={pending} onClick={() => run(() => hireAction({ orgId, proposalId, projectId }))} className={btn}>Hire and draft contract</button>
      <FormError error={error} />
    </div>
  );
}

export function ContractControls({ orgId, contractId, can, isOwner = false }: { orgId: string; contractId: string; can: { accept: boolean; activate: boolean; cancel: boolean }; isOwner?: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const { pending, error, run } = useContractAction((r) => { setNotice(acceptOutcomeMessage(r.outcome, isOwner) ?? ""); router.refresh(); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.accept && <button disabled={pending} onClick={() => run(() => acceptContractAction({ orgId, contractId }))} className={btn}>Accept terms</button>}
      {can.activate && <button disabled={pending} onClick={() => run(() => activateContractAction({ contractId }))} className={btn}>Start contract</button>}
      {can.cancel && <button disabled={pending} onClick={() => { if (window.confirm("Cancel this draft contract?")) run(() => cancelContractAction({ orgId, contractId, reason: "" })); }} className={btn}>Cancel draft</button>}
      <FormError error={error} />
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}

export function SubmitMilestoneButton({ orgId, contractId, milestoneId }: { orgId: string; contractId: string; milestoneId: string }) {
  const router = useRouter();
  const { pending, error, run } = useContractAction(() => router.refresh());
  return (
    <div className="flex items-center gap-2">
      <button disabled={pending} onClick={() => run(() => submitMilestoneAction({ orgId, contractId, milestoneId }))} className={btn}>Submit for approval</button>
      <FormError error={error} />
    </div>
  );
}

/** Approving creates the payment and sends the client to Stripe Checkout. The button disables itself so a double click cannot start two sessions. */
export function ApproveButton({ orgId, contractId, milestoneId, label }: { orgId: string; contractId: string; milestoneId: string; label: string }) {
  const { pending, error, run } = useContractAction((r) => { if (r.url) window.location.assign(r.url); });
  const [clicked, setClicked] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button disabled={pending || clicked} onClick={() => { setClicked(true); run(() => approveAndPayAction({ orgId, contractId, milestoneId })); setTimeout(() => setClicked(false), 4000); }} className={btn}>{label}</button>
      <FormError error={error} />
    </div>
  );
}

export function RequestChangesForm({ orgId, contractId, milestoneId }: { orgId: string; contractId: string; milestoneId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { pending, error, run } = useContractAction(() => { setNote(""); router.refresh(); });
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => requestChangesAction({ orgId, contractId, milestoneId, note })); }} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">Request changes
        <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required />
      </label>
      <button disabled={pending || note.trim() === ""} className={btn}>Send</button>
      <FormError error={error} />
    </form>
  );
}

export function PayoutButton({ orgId, label }: { orgId: string; label: string }) {
  const { pending, error, run } = useContractAction((r) => { if (r.url) window.location.assign(r.url); });
  return (
    <div className="flex items-center gap-2">
      <button disabled={pending} onClick={() => run(() => startPayoutOnboardingAction({ orgId }))} className={btn}>{label}</button>
      <FormError error={error} />
    </div>
  );
}

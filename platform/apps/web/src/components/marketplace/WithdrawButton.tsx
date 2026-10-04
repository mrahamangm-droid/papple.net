"use client";
import { useRouter } from "next/navigation";
import { withdrawProposalAction } from "@/app/(app)/marketplace-actions";
import { FormError, useAction } from "./useAction";

export function WithdrawButton({ orgId, id, projectId }: { orgId: string; id: string; projectId: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  return (
    <div className="flex items-center gap-2">
      <button disabled={pending} onClick={() => run(() => withdrawProposalAction({ orgId, id, projectId }))} className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Withdraw proposal</button>
      <FormError error={error} />
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { decideProposal } from "@/app/(app)/marketplace-actions";
import { FormError, useAction } from "./useAction";

export function DecideButtons({ id, projectId }: { id: string; projectId: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => decideProposal({ id, projectId, status: "shortlisted" }))} className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Shortlist</button>
      <button disabled={pending} onClick={() => run(() => decideProposal({ id, projectId, status: "declined" }))} className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Decline</button>
      <FormError error={error} />
    </div>
  );
}

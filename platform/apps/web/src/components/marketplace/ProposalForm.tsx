"use client";
import { useRouter } from "next/navigation";
import { submitProposalAction } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { OrgPicker } from "./OrgPicker";
import { FormError, fieldClass, int, money, str, useAction } from "./useAction";

export function ProposalForm({ projectId, orgs, currency }: { projectId: string; orgs: { id: string; name: string }[]; currency: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => submitProposalAction({ orgId: str(f, "orgId"), projectId, coverLetter: str(f, "coverLetter"), price: money(f, "price", currency), currency, deliveryDays: int(f, "deliveryDays") }));
    }}>
      <OrgPicker orgs={orgs} />
      <label className="block text-sm">Cover letter<textarea name="coverLetter" required maxLength={5000} rows={6} className={fieldClass} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Your price ({currency})<input name="price" type="number" required min={0.01} step="0.01" className={fieldClass} /></label>
        <label className="block text-sm">Delivery (days)<input name="deliveryDays" type="number" required min={1} max={3650} className={fieldClass} /></label>
      </div>
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Sending…" : "Submit proposal"}</Button>
    </form>
  );
}

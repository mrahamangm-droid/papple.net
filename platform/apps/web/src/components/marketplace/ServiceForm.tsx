"use client";
import { useRouter } from "next/navigation";
import { saveService } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { fromMinor } from "@/lib/marketplace/present";
import { FormError, cur, fieldClass, int, money, str, useAction } from "./useAction";

export function ServiceForm({ orgId, categories, defaults }: {
  orgId: string; categories: { id: string; name: string }[];
  defaults?: { id?: string; title?: string; description?: string; pricingModel?: string; priceMin?: number | null; currency?: string; deliveryDays?: number | null; status?: string; categoryId?: string | null };
}) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => saveService({
        orgId, id: defaults?.id, categoryId: str(f, "categoryId"), title: str(f, "title"), description: str(f, "description") ?? "",
        pricingModel: str(f, "pricingModel"), priceMin: money(f, "priceMin", cur(f)), currency: cur(f),
        deliveryDays: int(f, "deliveryDays"), status: str(f, "status"),
      }));
    }}>
      <label className="block text-sm">Service title<input name="title" required minLength={3} maxLength={120} defaultValue={defaults?.title} className={fieldClass} /></label>
      <label className="block text-sm">Description<textarea name="description" rows={5} maxLength={5000} defaultValue={defaults?.description} className={fieldClass} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Pricing
          <select name="pricingModel" defaultValue={defaults?.pricingModel ?? "quote"} className={fieldClass}>
            <option value="fixed">Fixed price</option><option value="hourly">Hourly</option><option value="quote">Custom quote</option>
          </select></label>
        <label className="block text-sm">Starting price<input name="priceMin" type="number" min={0} step="0.01" defaultValue={defaults?.priceMin == null ? "" : String(fromMinor(defaults.priceMin, defaults.currency ?? "USD"))} className={fieldClass} /></label>
        <label className="block text-sm">Currency<input name="currency" maxLength={3} defaultValue={defaults?.currency ?? "USD"} className={fieldClass} /></label>
        <label className="block text-sm">Delivery (days)<input name="deliveryDays" type="number" min={1} max={3650} defaultValue={defaults?.deliveryDays ?? ""} className={fieldClass} /></label>
        {categories.length > 0 && (
          <label className="block text-sm">Category
            <select name="categoryId" defaultValue={defaults?.categoryId ?? ""} className={fieldClass}>
              <option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}
        <label className="block text-sm">Status
          <select name="status" defaultValue={defaults?.status ?? "draft"} className={fieldClass}>
            <option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
          </select></label>
      </div>
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Saving…" : defaults?.id ? "Update service" : "Add service"}</Button>
    </form>
  );
}

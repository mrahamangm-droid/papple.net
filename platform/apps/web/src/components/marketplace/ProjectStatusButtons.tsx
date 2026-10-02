"use client";
import { useRouter } from "next/navigation";
import { changeProjectStatus } from "@/app/(app)/marketplace-actions";
import { FormError, useAction } from "./useAction";

export function ProjectStatusButtons({ orgId, id, status }: { orgId: string; id: string; status: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  const btn = (label: string, to: "open" | "closed" | "cancelled") => (
    <button disabled={pending} onClick={() => run(() => changeProjectStatus({ orgId, id, status: to }))} className="rounded-md border border-neutral-400 px-3 py-1 text-sm">{label}</button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && btn("Publish", "open")}
      {status === "open" && btn("Close to proposals", "closed")}
      {(status === "draft" || status === "open" || status === "closed") && btn("Cancel project", "cancelled")}
      <FormError error={error} />
    </div>
  );
}

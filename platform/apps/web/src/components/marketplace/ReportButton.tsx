"use client";
import { useState } from "react";
import { reportContent } from "@/app/(app)/marketplace-actions";
import { FormError, fieldClass, str, useAction } from "./useAction";

export function ReportButton({ kind, id }: { kind: "profile" | "service" | "project" | "message"; id: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const { pending, error, run } = useAction(() => { setDone(true); setOpen(false); });
  if (done) return <p role="status" className="text-xs">Thanks — our team will review this report.</p>;
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs underline">Report</button>;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => reportContent({ kind, id, reason: str(new FormData(e.currentTarget), "reason") })); }}>
      <label className="block text-xs">What is wrong?<textarea name="reason" required maxLength={1000} rows={3} className={fieldClass} /></label>
      <FormError error={error} />
      <button disabled={pending} className="rounded-md border border-neutral-400 px-3 py-1 text-xs">{pending ? "Sending…" : "Send report"}</button>
    </form>
  );
}

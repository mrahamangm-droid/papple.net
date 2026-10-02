"use client";
import { useRouter } from "next/navigation";
import { startThread } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { OrgPicker } from "./OrgPicker";
import { FormError, fieldClass, str, useAction } from "./useAction";

export function ContactForm({ kind, refId, orgs }: { kind: "service" | "profile" | "project" | "proposal"; refId: string; orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  const { pending, error, run } = useAction((r) => router.push(r.id ? `/messages/${r.id}` : "/messages"));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => startThread({ fromOrgId: str(f, "orgId"), kind, refId, firstMessage: str(f, "firstMessage") }));
    }}>
      <OrgPicker orgs={orgs} />
      <label className="block text-sm">Your message<textarea name="firstMessage" required maxLength={4000} rows={4} className={fieldClass} /></label>
      <p className="text-xs opacity-70">Keep conversations on Papple. Do not share phone numbers or emails in your first message.</p>
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
    </form>
  );
}

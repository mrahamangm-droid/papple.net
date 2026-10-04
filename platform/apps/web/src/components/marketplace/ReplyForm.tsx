"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { postMessage } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { FormError, fieldClass, str, useAction } from "./useAction";

export function ReplyForm({ conversationId, orgId }: { conversationId: string; orgId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const { pending, error, run } = useAction(() => { ref.current?.reset(); router.refresh(); });
  return (
    <form ref={ref} className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => postMessage({ conversationId, orgId, body: str(new FormData(e.currentTarget), "body") })); }}>
      <label className="block text-sm">Reply<textarea name="body" required maxLength={4000} rows={3} className={fieldClass} /></label>
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
    </form>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { markRead } from "@/app/(app)/marketplace-actions";
import { useAction } from "./useAction";

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const { pending, run } = useAction(() => router.refresh());
  return <button disabled={pending} onClick={() => run(() => markRead({ id }))} className="text-xs underline">Mark as read</button>;
}

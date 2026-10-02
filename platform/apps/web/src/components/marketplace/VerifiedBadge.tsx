import { VERIFIED_COPY } from "@/lib/admin/present";

/** Shown only for providers whose evidence Papple reviewed. The title states what it does not mean. */
export function VerifiedBadge() {
  return <span title={VERIFIED_COPY} className="ml-2 rounded-full border border-emerald-600 px-2 py-0.5 text-xs font-normal text-emerald-700 dark:text-emerald-400">Verified</span>;
}

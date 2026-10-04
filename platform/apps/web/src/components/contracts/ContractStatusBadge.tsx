import { contractStatusLabel } from "@/lib/contracts/present";

export function ContractStatusBadge({ status }: { status: string }) {
  return <span className="rounded-full border border-neutral-400 px-2 py-0.5 text-xs uppercase tracking-wide">{contractStatusLabel(status)}</span>;
}

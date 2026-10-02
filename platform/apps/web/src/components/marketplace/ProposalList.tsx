import type { ReactNode } from "react";
import { formatMinor } from "@/lib/marketplace/present";

export interface ProposalRow {
  id: string; orgName: string; coverLetter: string; price: number; currency: string; deliveryDays: number; status: string;
}

/** Renders exactly what it is given. Row-level security decides which proposals reach it; it never fetches or filters. */
export function ProposalList({ proposals, renderActions }: { proposals: ProposalRow[]; renderActions?: (p: ProposalRow) => ReactNode }) {
  if (proposals.length === 0) return <p role="status" className="text-sm">No proposals yet.</p>;
  return (
    <ul className="space-y-4">
      {proposals.map((p) => (
        <li key={p.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="font-medium">{p.orgName} <span className="ml-2 text-xs uppercase opacity-70">{p.status}</span></p>
          <p className="text-sm opacity-80">{formatMinor(p.price, p.currency)} · {p.deliveryDays} days</p>
          <p className="mt-2 whitespace-pre-line text-sm">{p.coverLetter}</p>
          {renderActions && <div className="mt-3">{renderActions(p)}</div>}
        </li>
      ))}
    </ul>
  );
}

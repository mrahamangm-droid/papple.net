import type { ReactNode } from "react";
import { milestoneStatusLabel } from "@/lib/contracts/present";
import { formatMinor } from "@/lib/marketplace/present";

export interface MilestoneRow {
  id: string; position: number; title: string; description: string; amount: number;
  due_date: string | null; status: string; change_note: string | null;
}

/** Renders exactly the milestones it is given; row-level security decides who sees them. Actions come from the caller. */
export function MilestoneList({ milestones, currency, renderActions }: { milestones: MilestoneRow[]; currency: string; renderActions?: (m: MilestoneRow) => ReactNode }) {
  if (milestones.length === 0) return <p role="status" className="text-sm">No milestones yet.</p>;
  return (
    <ol className="space-y-3">
      {milestones.map((m) => (
        <li key={m.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="font-medium">{m.position}. {m.title} <span className="ml-2 text-xs uppercase opacity-70">{milestoneStatusLabel(m.status)}</span></p>
          <p className="text-sm opacity-80">{formatMinor(m.amount, currency)}{m.due_date ? ` · due ${m.due_date}` : ""}</p>
          {m.description && <p className="mt-1 whitespace-pre-line text-sm">{m.description}</p>}
          {m.change_note && <p className="mt-2 text-sm"><span className="font-medium">Changes requested:</span> {m.change_note}</p>}
          {renderActions && <div className="mt-3">{renderActions(m)}</div>}
        </li>
      ))}
    </ol>
  );
}

import { budgetMeter } from "@/lib/budgets/present";
import type { BudgetStatus } from "@/lib/budgets/service";

/** Usage bar for a budget that is on. Renders nothing otherwise. */
export function BudgetMeter({ status }: { status: BudgetStatus | null }) {
  const m = budgetMeter(status);
  if (!m) return null;
  return (
    <div className="mt-3 max-w-md text-sm">
      <p>{m.text}</p>
      <div role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.percent}
        className="mt-1 h-2 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-2 rounded ${m.over ? "bg-red-600" : "bg-neutral-700 dark:bg-neutral-300"}`} style={{ width: `${m.percent}%` }} />
      </div>
      {m.note && <p className={`mt-1 ${m.over ? "text-red-700 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}`}>{m.note}</p>}
    </div>
  );
}

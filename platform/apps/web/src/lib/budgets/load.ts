import { parseStatus, type BudgetStatus } from "./service";

type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** The organization's budget usage, or null (no budget, not allowed to see it, or any hiccup: a page never breaks over it). */
export async function loadBudgetStatus(db: Db, orgId: string): Promise<BudgetStatus | null> {
  try {
    const { data, error } = await db.rpc("budget_status", { p_org: orgId });
    return error ? null : parseStatus(data);
  } catch {
    return null;
  }
}

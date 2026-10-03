import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { DismissForm, VisibilityForm } from "@/components/admin/ConsoleForms";
import { KIND_LABEL, canHide } from "@/lib/admin/moderation";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

interface Row { report_id: string; target_kind: string; target_id: string; reason: string; created_at: string; open_count: number; target_label: string | null; target_status: string | null }

export default async function ReportsPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("moderation_queue", { p_limit: 50 });
  const rows = (data ?? []) as Row[];
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="mt-1 text-sm opacity-80">Open reports, oldest first. <Link className="underline" href="/admin/reports/hidden">Hidden items</Link></p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">{error.code === "42501" ? "Verify your second factor to see the queue." : "The queue could not be loaded. Please try again."}</p>}
      <ul className="mt-6 space-y-4">
        {rows.map((r) => (
          <li key={r.report_id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{KIND_LABEL[r.target_kind] ?? r.target_kind}: {r.target_label ?? "(removed)"} <span className="text-xs opacity-70">{r.open_count} open report{r.open_count === 1 ? "" : "s"} · {r.target_status}</span></p>
            <p className="mt-1 whitespace-pre-line text-sm">{r.reason}</p>
            <p className="text-xs opacity-70">Reported {r.created_at.slice(0, 10)}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {canHide(r.target_kind) && r.target_label !== null ? <VisibilityForm kind={r.target_kind as "profile" | "service" | "project"} id={r.target_id} hidden /> : <p className="text-sm opacity-80">{r.target_label === null ? "The reported item no longer exists. Dismiss the report." : "Messages cannot be hidden here. Dismiss the report if no action is needed."}</p>}
              <DismissForm reportId={r.report_id} />
            </div>
          </li>
        ))}
        {!error && rows.length === 0 && <li className="text-sm">No open reports.</li>}
      </ul>
    </AppShell>
  );
}

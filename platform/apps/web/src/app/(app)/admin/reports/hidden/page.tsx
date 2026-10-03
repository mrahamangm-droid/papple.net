import { AppShell } from "@/components/shell/AppShell";
import { VisibilityForm } from "@/components/admin/ConsoleForms";
import { KIND_LABEL } from "@/lib/admin/moderation";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Hidden items" };
export const dynamic = "force-dynamic";

export default async function HiddenPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("hidden_items", { p_limit: 100 });
  const rows = (data ?? []) as { target_kind: string; target_id: string; target_label: string | null }[];
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Hidden items</h1>
      {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">{error.code === "42501" ? "Verify your second factor to see hidden items." : "Hidden items could not be loaded. Please try again."}</p>}
      <ul className="mt-6 space-y-4">
        {rows.map((r) => (
          <li key={`${r.target_kind}-${r.target_id}`} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{KIND_LABEL[r.target_kind]}: {r.target_label}</p>
            <VisibilityForm kind={r.target_kind as "profile" | "service" | "project"} id={r.target_id} hidden={false} />
          </li>
        ))}
        {!error && rows.length === 0 && <li className="text-sm">Nothing is hidden.</li>}
      </ul>
    </AppShell>
  );
}

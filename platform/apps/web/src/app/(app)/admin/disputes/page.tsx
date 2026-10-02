import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { requireCapability } from "@/lib/auth-context";
import { sortQueue } from "@/lib/disputes/present";
import { formatMinor } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Disputes" };
export const dynamic = "force-dynamic";

export default async function DisputeQueue() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  // Row-level security lets platform staff read every dispute.
  const { data } = await db.from("disputes").select("id, reason, opened_at, contracts(title, price, currency)").eq("status", "open").limit(200);
  const rows = sortQueue((data ?? []).map((d) => ({ ...d, opened_at: d.opened_at as string })));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Open disputes</h1>
      <p className="mt-1 text-sm opacity-80">Oldest first.</p>
      <ul className="mt-6 space-y-3">
        {rows.map((d) => {
          const c = (Array.isArray(d.contracts) ? d.contracts[0] : d.contracts) as { title: string; price: number; currency: string } | null;
          return (
            <li key={d.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <Link className="font-medium underline" href={`/admin/disputes/${d.id}`}>{c?.title ?? "Contract"}</Link>
              <p className="mt-1 text-sm opacity-80">{c ? formatMinor(c.price, c.currency) : ""} · opened {new Date(d.opened_at).toISOString().slice(0, 10)}</p>
              <p className="mt-1 text-sm">{(d.reason as string).slice(0, 200)}</p>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-sm">No open disputes.</li>}
      </ul>
    </AppShell>
  );
}

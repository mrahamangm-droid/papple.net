import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { ContractStatusBadge } from "@/components/contracts/ContractStatusBadge";
import { requireCapability } from "@/lib/auth-context";
import { formatMinor } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

export default async function Contracts() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  // Row-level security returns only contracts of organizations the user belongs to (or all, for platform admins).
  const { data } = await db.from("contracts").select("id, title, price, currency, status, client_org_id, created_at").order("created_at", { ascending: false }).limit(100);
  const mine = new Set(ctx.memberships.map((m) => m.orgId));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Contracts</h1>
      <ul className="mt-6 space-y-3">
        {(data ?? []).map((c) => (
          <li key={c.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <Link className="font-medium underline" href={`/contracts/${c.id}`}>{c.title as string}</Link>{" "}
            <ContractStatusBadge status={c.status as string} />
            <p className="mt-1 text-sm opacity-80">{formatMinor(c.price as number, c.currency as string)} · {mine.has(c.client_org_id as string) ? "You are the client" : "You are the professional"}</p>
          </li>
        ))}
        {(data ?? []).length === 0 && <li className="text-sm">No contracts yet. Hire a professional from a project&apos;s proposals to start one.</li>}
      </ul>
    </AppShell>
  );
}

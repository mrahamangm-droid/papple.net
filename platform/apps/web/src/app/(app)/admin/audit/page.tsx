import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { describeAuditAction } from "@/lib/admin/present";
import { AUDIT_PAGE_SIZE, nextCursor, parseAuditFilters } from "@/lib/admin/validators";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCapability("platform.admin");
  const q = await searchParams;
  const f = parseAuditFilters(q);
  const db = await createServerSupabase();
  let query = db.from("audit_log").select("id, at, actor_id, action, entity, entity_id, outcome, after").order("id", { ascending: false }).limit(AUDIT_PAGE_SIZE);
  if (f.actor) query = query.eq("actor_id", f.actor);
  if (f.action) query = query.like("action", `${f.action.replace(/_/g, "\\_")}%`);
  if (f.outcome) query = query.eq("outcome", f.outcome);
  if (f.from) query = query.gte("at", `${f.from}T00:00:00Z`);
  if (f.to) query = query.lt("at", new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000).toISOString());
  if (f.before) query = query.lt("id", f.before);
  const { data } = await query;
  const rows = (data ?? []) as { id: number; at: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; outcome: string; after: { reason?: string } | null }[];
  const cursor = nextCursor(rows, AUDIT_PAGE_SIZE);
  const keep = new URLSearchParams(Object.entries(f).filter(([k]) => k !== "before").map(([k, v]) => [k, String(v)]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <form className="mt-4 grid gap-2 sm:grid-cols-5" method="get">
        <input name="actor" placeholder="Actor user id" defaultValue={f.actor} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm" />
        <input name="action" placeholder="Action prefix, e.g. admin." defaultValue={f.action} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm" />
        <select name="outcome" defaultValue={f.outcome ?? ""} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm">
          <option value="">Any outcome</option><option>success</option><option>denied</option><option>invalid</option><option>error</option>
        </select>
        <input name="from" type="date" defaultValue={f.from} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm" aria-label="From date" />
        <input name="to" type="date" defaultValue={f.to} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm" aria-label="To date" />
        <button className="rounded-md border border-neutral-400 px-3 py-1 text-sm sm:col-span-5 sm:w-32">Filter</button>
      </form>
      <ul className="mt-6 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <p><span className="font-medium">{describeAuditAction(r.action)}</span> <span className="opacity-70">· {r.outcome} · {r.at.slice(0, 19).replace("T", " ")} UTC</span></p>
            <p className="opacity-80">{r.entity}{r.entity_id ? ` ${r.entity_id}` : ""} · actor {r.actor_id ?? "none"}</p>
            {r.after?.reason && <p className="mt-1">Reason: {r.after.reason}</p>}
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm">No entries match.</li>}
      </ul>
      {cursor && <p className="mt-4"><Link className="underline" href={`/admin/audit?${new URLSearchParams([...keep, ["before", String(cursor)]]).toString()}`}>Older entries</Link></p>}
    </AppShell>
  );
}

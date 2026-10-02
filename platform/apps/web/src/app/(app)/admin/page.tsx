import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { describeAuditAction } from "@/lib/admin/present";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const head = { count: "exact" as const, head: true };
  const [disputes, reports, verifications, suspended, recent] = await Promise.all([
    db.from("disputes").select("id", head).eq("status", "open"),
    db.from("content_reports").select("id", head).eq("status", "open"),
    db.from("verification_requests").select("id", head).eq("status", "pending"),
    db.from("organizations").select("id", head).eq("status", "suspended"),
    db.from("audit_log").select("id, at, action, outcome").order("id", { ascending: false }).limit(10),
  ]);
  const cards = [
    { href: "/admin/disputes", label: "Open disputes", n: disputes.count },
    { href: "/admin/reports", label: "Open reports", n: reports.count },
    { href: "/admin/verification", label: "Pending verifications", n: verifications.count },
    { href: "/admin/organizations", label: "Suspended organizations", n: suspended.count },
  ];
  const tools = [["/admin/settings", "Settings and flags"], ["/admin/plans", "Plans"], ["/admin/taxonomy", "Taxonomy"], ["/admin/staff", "Staff"], ["/admin/audit", "Audit log"]];
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Admin</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}><Card><Link className="underline" href={c.href}>{c.label}</Link><p className="mt-1 text-2xl font-semibold">{c.n ?? "–"}</p></Card></li>
        ))}
      </ul>
      <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">{tools.map(([h, l]) => <Link key={h} className="underline" href={h}>{l}</Link>)}</p>
      <h2 className="mt-8 text-lg font-semibold">Recent activity</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {(recent.data ?? []).map((r) => (
          <li key={r.id as number}>{describeAuditAction(r.action as string)} <span className="opacity-70">· {r.outcome as string} · {(r.at as string).slice(0, 16).replace("T", " ")} UTC</span></li>
        ))}
        {(recent.data ?? []).length === 0 && <li>No activity yet.</li>}
      </ul>
    </AppShell>
  );
}

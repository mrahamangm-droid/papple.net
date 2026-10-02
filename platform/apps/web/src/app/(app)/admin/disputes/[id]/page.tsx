import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { RetryRefunds, RulingForm } from "@/components/disputes/RulingForm";
import { requireCapability } from "@/lib/auth-context";
import { refundState, rulingChoices } from "@/lib/disputes/present";
import { formatMinor } from "@/lib/marketplace/present";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

export const metadata = { title: "Dispute" };
export const dynamic = "force-dynamic";

export default async function DisputeDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCapability("platform.admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await createServerSupabase();
  const { data: d } = await db.from("disputes").select("id, contract_id, reason, status, resolution, resolution_note, opened_at, raised_by_org_id").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [c, ms, ps, rs] = await Promise.all([
    db.from("contracts").select("id, title, price, currency, status, client_org_id, provider_org_id").eq("id", d.contract_id).maybeSingle(),
    db.from("milestones").select("id, position, title, amount, status").eq("contract_id", d.contract_id).order("position"),
    db.from("payments").select("id, milestone_id, client_total, currency, status").eq("contract_id", d.contract_id),
    db.from("refunds").select("id, payment_id, amount, currency, status").eq("dispute_id", id),
  ]);
  const contract = c.data;
  const payments = ps.data ?? [];
  const refunds = rs.data ?? [];
  const state = refundState(refunds as { status: string }[]);
  const open = d.status === "open";
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Dispute: {contract?.title ?? "Contract"}</h1>
      <Card className="mt-6">
        <h2 className="font-medium">Reason</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{d.reason as string}</p>
        <p className="mt-2 text-sm opacity-80">Status: {d.status as string}{d.resolution ? ` (${d.resolution})` : ""}</p>
        {d.resolution_note && <p className="mt-1 text-sm">Ruling note: {d.resolution_note as string}</p>}
      </Card>
      <Card className="mt-4">
        <h2 className="font-medium">Milestones and payments</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(ms.data ?? []).map((m) => {
            const p = payments.find((x) => x.milestone_id === m.id);
            return <li key={m.id as string}>{m.position as number}. {m.title as string} — {formatMinor(m.amount as number, contract?.currency ?? "USD")} · milestone {m.status as string}{p ? ` · payment ${p.status as string} (${formatMinor(p.client_total as number, p.currency as string)})` : " · no payment"}</li>;
          })}
        </ul>
      </Card>
      {refunds.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-medium">Refunds</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {refunds.map((r) => <li key={r.id as string}>{formatMinor(r.amount as number, r.currency as string)} — {r.status as string}</li>)}
          </ul>
          {state.canRetry && <div className="mt-3"><RetryRefunds disputeId={id} /></div>}
        </Card>
      )}
      {open && (
        <Card className="mt-4">
          <h2 className="font-medium">Rule on this dispute</h2>
          <div className="mt-3"><RulingForm disputeId={id} choices={rulingChoices(payments.map((p) => p.status as string))} /></div>
        </Card>
      )}
    </AppShell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { ApproveButton, ContractControls, RequestChangesForm, SubmitMilestoneButton } from "@/components/contracts/ContractButtons";
import { IssueCreditNoteButton, IssueInvoiceButton } from "@/components/invoices/InvoiceButtons";
import { milestoneInvoiceActions } from "@/lib/invoices/present";
import { DisputeForm, MilestoneEditor, ReviewForm } from "@/components/contracts/ContractForms";
import { ContractStatusBadge } from "@/components/contracts/ContractStatusBadge";
import { MilestoneList, type MilestoneRow } from "@/components/contracts/MilestoneList";
import { PaymentNotice } from "@/components/contracts/PaymentNotice";
import { requireCapability } from "@/lib/auth-context";
import { contractActions, milestoneActions, milestoneTotal, viewerSide } from "@/lib/contracts/present";
import { formatMinor } from "@/lib/marketplace/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Contract" };
export const dynamic = "force-dynamic";

export default async function ContractPage({ params, searchParams }: PageProps<"/contracts/[id]">) {
  const { id } = await params;
  const justPaid = (await searchParams).paid === "1"; // back from Stripe: the webhook confirms payment, never this redirect
  if (!isValidUuid(id)) notFound();
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data: c } = await db.from("contracts")
    .select("id, title, price, currency, status, client_org_id, provider_org_id, accepted_by_client, accepted_by_provider, proposal_id, project_id, cancelled_reason").eq("id", id).maybeSingle();
  if (!c) notFound(); // RLS hides other organizations' contracts, so this is also the not-allowed case

  const [{ data: ms }, { data: disputes }, { data: reviews }, { data: who }, { data: invs }, { data: pays }] = await Promise.all([
    db.from("milestones").select("id, position, title, description, amount, due_date, status, change_note").eq("contract_id", id).order("position"),
    db.from("disputes").select("id, status, reason, opened_at, resolution").eq("contract_id", id).order("opened_at", { ascending: false }),
    db.from("reviews").select("author_org_id, subject_org_id, rating, comment").eq("contract_id", id),
    db.from("proposal_providers").select("headline, slug").eq("proposal_id", c.proposal_id as string).maybeSingle(),
    db.from("invoices").select("id, milestone_id, kind, credits_invoice_id, number").eq("contract_id", id),
    db.from("payments").select("milestone_id, status").eq("contract_id", id),
  ]);
  const invoiceOf = new Map((invs ?? []).filter((i) => i.kind === "invoice").map((i) => [i.milestone_id as string, i]));
  const creditOf = new Map((invs ?? []).filter((i) => i.kind === "credit_note").map((i) => [i.credits_invoice_id as string, i]));
  const refundedMilestones = new Set((pays ?? []).filter((p) => p.status === "refunded").map((p) => p.milestone_id as string));
  const milestones = (ms ?? []) as MilestoneRow[];
  const view = viewerSide(c as { client_org_id: string; provider_org_id: string }, ctx.memberships.map((m) => ({ id: m.orgId, role: m.role })));
  const hasReviewed = view ? (reviews ?? []).some((r) => r.author_org_id === view.orgId) : false;
  const can = view
    ? contractActions({ side: view.side, role: view.role, hasReviewed, contract: c as { status: string; accepted_by_client: boolean; accepted_by_provider: boolean } })
    : null;
  const currency = c.currency as string;
  const openDispute = (disputes ?? []).find((d) => d.status === "open");

  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">{c.title as string} <ContractStatusBadge status={c.status as string} /></h1>
      <p className="mt-1 text-sm opacity-70">
        {formatMinor(c.price as number, currency)} · {view?.side === "client" ? "You are the client" : view?.side === "provider" ? "You are the professional" : "Read-only view"}
        {who?.headline ? ` · ${who.headline as string}` : ""}
      </p>
      {who?.slug && <p className="mt-1 text-sm"><Link className="underline" href={`/p/${who.slug as string}`}>View professional profile</Link></p>}
      {view && <div className="mt-4 max-w-2xl"><PaymentNotice side={view.side} /></div>}
      {view && <p className="mt-2 text-sm"><Link className="underline" href={`/contracts/${id}/work`}>Tasks, time and files</Link></p>}

      {c.status === "cancelled" && c.cancelled_reason && <p className="mt-4 text-sm">Cancelled: {c.cancelled_reason as string}</p>}
      {openDispute && (
        <p role="alert" className="mt-4 max-w-2xl rounded-md border border-red-400 p-3 text-sm">
          This contract is in dispute. Further payments are paused until our team resolves it.
        </p>
      )}

      <section className="mt-8" aria-label="Milestones">
        <h2 className="text-lg font-semibold">Milestones</h2>
        {can?.editMilestones && view ? (
          <Card className="mt-3 max-w-2xl">
            <MilestoneEditor orgId={view.orgId} contractId={id} currency={currency} price={c.price as number}
              initial={milestones.map((m) => ({ title: m.title, description: m.description, amount: m.amount, due_date: m.due_date }))} />
          </Card>
        ) : (
          <div className="mt-3 max-w-2xl">
            <MilestoneList milestones={milestones} currency={currency} renderActions={view ? (m) => {
              const a = milestoneActions({ side: view.side, role: view.role, contractStatus: c.status as string, milestoneStatus: m.status });
              const inv = invoiceOf.get(m.id);
              const ia = milestoneInvoiceActions({
                side: view.side, role: view.role, milestoneStatus: m.status, invoice: (inv?.id as string | undefined) ?? null,
                creditNote: inv ? ((creditOf.get(inv.id as string)?.id as string | undefined) ?? null) : null, refunded: refundedMilestones.has(m.id),
              });
              const credit = inv ? creditOf.get(inv.id as string) : undefined;
              if (!a.submit && !a.approve && !a.requestChanges && !ia.issue && !ia.view) return null;
              return (
                <div className="space-y-2">
                  {ia.issue && <IssueInvoiceButton orgId={view.orgId} contractId={id} milestoneId={m.id} />}
                  {ia.view && <p className="text-sm"><Link className="underline" href={`/contracts/${id}/invoices/${ia.view}`}>View invoice {inv?.number as string}</Link>{credit && <> · <Link className="underline" href={`/contracts/${id}/invoices/${credit.id as string}`}>View credit note {credit.number as string}</Link></>}</p>}
                  {ia.creditNote && inv && <IssueCreditNoteButton orgId={view.orgId} contractId={id} invoiceId={inv.id as string} />}
                  {a.submit && <SubmitMilestoneButton orgId={view.orgId} contractId={id} milestoneId={m.id} />}
                  {a.approve && justPaid && m.status === "approved" && (
                    <p className="text-sm" role="status">Thanks. Stripe is confirming your payment; this page updates when it arrives. Please do not pay again.</p>
                  )}
                  {a.approve && !(justPaid && m.status === "approved") && <ApproveButton orgId={view.orgId} contractId={id} milestoneId={m.id} label={m.status === "approved" ? "Retry payment" : "Approve and pay"} />}
                  {a.requestChanges && <RequestChangesForm orgId={view.orgId} contractId={id} milestoneId={m.id} />}
                </div>
              );
            } : undefined} />
            <p className="mt-2 text-sm opacity-70">Total {formatMinor(milestoneTotal(milestones), currency)}</p>
          </div>
        )}
      </section>

      {view && can && (can.accept || can.activate || can.cancel) && (
        <section className="mt-6" aria-label="Contract actions">
          <ContractControls orgId={view.orgId} contractId={id} can={can} />
          {c.status === "draft" && view.side === "provider" && <p className="mt-2 text-sm">To start, you must finish <Link className="underline" href="/settings/payouts">payout setup</Link>.</p>}
        </section>
      )}

      {view && can?.dispute && (
        <section className="mt-8 max-w-2xl" aria-label="Dispute">
          <h2 className="text-lg font-semibold">Something wrong?</h2>
          <div className="mt-3"><DisputeForm orgId={view.orgId} contractId={id} /></div>
        </section>
      )}

      {c.status === "completed" && (
        <section className="mt-8 max-w-2xl" aria-label="Reviews">
          <h2 className="text-lg font-semibold">Reviews</h2>
          <ul className="mt-3 space-y-2">
            {(reviews ?? []).map((r, i) => (
              <li key={i} className="text-sm">{"★".repeat(r.rating as number)} {r.comment as string}{view && r.author_org_id === view.orgId ? " (yours)" : ""}</li>
            ))}
            {(reviews ?? []).length === 0 && <li className="text-sm">No reviews visible yet.</li>}
          </ul>
          {view && can?.review && <div className="mt-4"><ReviewForm orgId={view.orgId} contractId={id} /></div>}
        </section>
      )}
    </AppShell>
  );
}

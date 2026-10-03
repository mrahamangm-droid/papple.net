import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { PrintButton } from "@/components/invoices/PrintButton";
import { requireCapability } from "@/lib/auth-context";
import { INVOICE, invoiceTitle, taxLabel } from "@/lib/invoices/present";
import { formatMinor } from "@/lib/marketplace/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

interface Party { name?: string; legal_name?: string; address?: string; country?: string; tax_number?: string | null }

function PartyBlock({ label, p }: { label: string; p: Party }) {
  return (
    <div>
      <p className="text-xs uppercase opacity-70">{label}</p>
      <p className="font-medium">{p.legal_name ?? p.name}</p>
      {p.address && <p className="whitespace-pre-line text-sm">{p.address}</p>}
      {p.country && <p className="text-sm">{p.country}</p>}
      {p.tax_number && <p className="text-sm">Tax number: {p.tax_number}</p>}
    </div>
  );
}

export default async function InvoicePage({ params }: PageProps<"/contracts/[id]/invoices/[invoiceId]">) {
  const { id, invoiceId } = await params;
  if (!isValidUuid(id) || !isValidUuid(invoiceId)) notFound();
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data: i } = await db.from("invoices")
    .select("id, contract_id, kind, number, issued_at, currency, net, tax_bps, tax, total, issuer, recipient, description")
    .eq("id", invoiceId).eq("contract_id", id).maybeSingle();
  if (!i) notFound(); // RLS hides other contracts' invoices, so this is also the not-allowed case
  const cur = i.currency as string;
  const title = invoiceTitle(i.kind as "invoice" | "credit_note");
  return (
    <AppShell ctx={ctx}>
      <p className="print:hidden"><Link className="text-sm underline" href={`/contracts/${id}`}>Back to contract</Link></p>
      <article className="mt-4 max-w-2xl" aria-label={title}>
        <h1 className="text-2xl font-semibold">{title} {i.number as string}</h1>
        <p className="mt-1 text-sm">Issued {new Date(i.issued_at as string).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" })} · Currency {cur}</p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <PartyBlock label="From" p={i.issuer as Party} />
          <PartyBlock label="To" p={i.recipient as Party} />
        </div>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b border-neutral-300 text-left"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            <tr><td className="py-2">{i.description as string}</td><td className="py-2 text-right">{i.kind === "credit_note" ? "-" : ""}{formatMinor(i.net as number, cur)}</td></tr>
            <tr><td className="py-1">{taxLabel(i.tax_bps as number)}</td><td className="py-1 text-right">{i.kind === "credit_note" ? "-" : ""}{formatMinor(i.tax as number, cur)}</td></tr>
          </tbody>
          <tfoot><tr className="border-t border-neutral-300 font-semibold"><td className="py-2">Total</td><td className="py-2 text-right">{i.kind === "credit_note" ? "-" : ""}{formatMinor(i.total as number, cur)}</td></tr></tfoot>
        </table>
        {!INVOICE.reviewed && <p className="mt-6 text-xs opacity-70">{INVOICE.note}</p>}
        <div className="mt-6 print:hidden"><PrintButton /></div>
      </article>
    </AppShell>
  );
}

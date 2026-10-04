import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { AddDealForm, AddNoteForm, CompleteNoteButton, DealStageSelect, DeleteContactButton } from "@/components/crm/CrmForms";
import { requireCapability } from "@/lib/auth-context";
import { BasisForm, SendEmailForm } from "@/components/crm/CrmEmailForms";
import { basisLabel, formatDealValue } from "@/lib/crm/present";
import { settings } from "@/lib/server";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "member"];
const day = (iso: string) => iso.slice(0, 10);

export default async function ContactPage({ params }: PageProps<"/crm/[id]">) {
  const ctx = await requireCapability("org.read");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const db = await createServerSupabase();
  const { data: c } = await db.from("crm_contacts").select("id, org_id, name, company, email, phone, source, basis, created_at").eq("id", id).maybeSingle();
  if (!c) notFound();
  const orgId = c.org_id as string;
  const role = ctx.memberships.find((m) => m.orgId === orgId)?.role;
  // Platform admins can read every row through RLS; the screen is for the organization's own members only.
  if (!role) notFound();
  const [{ data: deals }, { data: notes }, { data: mails }, { data: suppressed }, emailOn, { data: profile }] = await Promise.all([
    db.from("crm_deals").select("id, title, stage, value, currency, expected_close").eq("contact_id", id).order("created_at", { ascending: false }),
    db.from("crm_notes").select("id, body, follow_up_at, done_at, created_at").eq("contact_id", id).order("created_at", { ascending: false }),
    db.from("crm_emails").select("id, subject, status, created_at").eq("contact_id", id).order("created_at", { ascending: false }).limit(20),
    c.email ? db.from("crm_suppressions").select("reason").eq("org_id", orgId).eq("email", (c.email as string).toLowerCase()).maybeSingle() : Promise.resolve({ data: null }),
    settings.isFlagEnabled("crm.email", orgId).catch(() => false),
    db.from("billing_profiles").select("org_id").eq("org_id", orgId).maybeSingle(),
  ]);
  const canWrite = !!role && WRITERS.includes(role);
  const canDelete = role === "owner" || role === "admin";
  return (
    <AppShell ctx={ctx}>
      <p className="text-sm"><Link className="underline" href={`/crm?org=${orgId}`}>All contacts</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">{c.name as string}</h1>
      <p className="mt-1 text-sm opacity-80">{[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No further details."}</p>
      <p className="mt-1 text-xs opacity-60">Added {day(c.created_at as string)} · source: {c.source as string}</p>

      <h2 className="mt-8 text-lg font-semibold">Deals</h2>
      <ul className="mt-2 space-y-2">
        {(deals ?? []).map((d) => (
          <li key={d.id as string} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{d.title as string}</span>
            <span>{formatDealValue(d.value as number | null, d.currency as string | null)}</span>
            {d.expected_close ? <span className="opacity-70">closes {d.expected_close as string}</span> : null}
            {canWrite ? (
              <DealStageSelect orgId={orgId} contactId={id} dealId={d.id as string} title={d.title as string} stage={d.stage as string}
                value={d.value as number | null} currency={d.currency as string | null} expectedClose={(d.expected_close as string | null) ?? null} />
            ) : <span>{d.stage as string}</span>}
          </li>
        ))}
        {(deals ?? []).length === 0 && <li className="text-sm">No deals yet.</li>}
      </ul>
      {canWrite && <AddDealForm orgId={orgId} contactId={id} />}

      <h2 className="mt-8 text-lg font-semibold">Notes and follow-ups</h2>
      <ul className="mt-2 space-y-3">
        {(notes ?? []).map((n) => (
          <li key={n.id as string} className="text-sm">
            <p className="whitespace-pre-line">{n.body as string}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
              <span>{day(n.created_at as string)}</span>
              {n.follow_up_at ? <span>follow up {(n.follow_up_at as string).slice(0, 16).replace("T", " ")} UTC{n.done_at ? " · done" : ""}</span> : null}
              {canWrite && n.follow_up_at && !n.done_at ? <CompleteNoteButton orgId={orgId} contactId={id} noteId={n.id as string} /> : null}
            </p>
          </li>
        ))}
        {(notes ?? []).length === 0 && <li className="text-sm">No notes yet.</li>}
      </ul>
      {canWrite && <AddNoteForm orgId={orgId} contactId={id} />}

      <h2 className="mt-8 text-lg font-semibold">Email</h2>
      {!emailOn ? (
        <p className="mt-2 text-sm">Email from the CRM is not switched on for your account yet.</p>
      ) : !c.email ? (
        <p className="mt-2 text-sm">Add an email address to this contact to send them a message.</p>
      ) : suppressed ? (
        <p className="mt-2 text-sm">This address has {suppressed.reason === "unsubscribe" ? "unsubscribed" : suppressed.reason === "bounce" ? "bounced" : "marked a message as spam"}, so it cannot be emailed again.</p>
      ) : (
        <>
          <p className="mt-2 text-sm">Reason recorded: {basisLabel((c.basis as string | null) ?? null)}</p>
          {canWrite && <BasisForm orgId={orgId} contactId={id} basis={(c.basis as string | null) ?? null} />}
          {canWrite && c.basis && !profile && <p className="mt-2 text-sm">Save your <Link className="underline" href="/settings/invoicing">billing details</Link> first: your legal name and address go in the email footer.</p>}
          {canWrite && c.basis && profile && <SendEmailForm orgId={orgId} contactId={id} to={c.email as string} />}
        </>
      )}
      <ul className="mt-4 space-y-1 text-sm">
        {(mails ?? []).map((m) => (
          <li key={m.id as string}>{m.subject as string} <span className="opacity-70">· {m.status as string} · {day(m.created_at as string)}</span></li>
        ))}
      </ul>

      {canDelete && <div className="mt-10"><DeleteContactButton orgId={orgId} id={id} /></div>}
    </AppShell>
  );
}

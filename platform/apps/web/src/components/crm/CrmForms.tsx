"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addNoteAction, completeNoteAction, deleteContactAction, importContactsAction, saveContactAction, saveDealAction } from "@/app/(app)/crm-actions";
import { crmFailureMessage, describeImport, STAGES, stageLabel } from "@/lib/crm/present";
import type { CrmFailure, CsvFailure } from "@/lib/crm/service";
import { CSV_MAX_BYTES } from "@/lib/crm/csv";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";

type Fail = { ok: false; code: CrmFailure | CsvFailure };

function useCrmAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<{ ok: true } | Fail | { ok: true; id: string } | { ok: true; report: Parameters<typeof describeImport>[0] }>, onOk: (r: unknown) => void) => start(async () => {
    setError(""); setNote("");
    try {
      const r = await fn();
      if (r.ok) onOk(r); else setError(crmFailureMessage(r.code));
    } catch {
      setError(crmFailureMessage("error"));
    }
  });
  return { pending, error, note, setNote, run };
}

const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

export function AddContactForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <form className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      run(() => saveContactAction({ orgId, name: String(f.get("name") ?? ""), email: String(f.get("email") ?? ""), company: String(f.get("company") ?? ""), phone: String(f.get("phone") ?? "") }), () => { form.reset(); router.refresh(); });
    }}>
      <label className="block text-sm">Name<input name="name" required maxLength={160} className={field} /></label>
      <label className="block text-sm">Email<input name="email" type="email" maxLength={254} className={field} /></label>
      <label className="block text-sm">Company<input name="company" maxLength={160} className={field} /></label>
      <label className="block text-sm">Phone<input name="phone" maxLength={40} className={field} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={btn}>Add contact</button>
        <Err error={error} />
      </div>
    </form>
  );
}

export function ImportContactsForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const { pending, error, note, setNote, run } = useCrmAction();
  const [tooBig, setTooBig] = useState(false);
  return (
    <form className="mt-3 max-w-xl space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const file = f.get("file");
      if (!(file instanceof File) || file.size === 0) return;
      if (file.size > CSV_MAX_BYTES) { setTooBig(true); return; }
      setTooBig(false);
      run(async () => importContactsAction({ orgId, csv: await file.text(), attested: f.get("attested") === "on" }), (r) => {
        setNote(describeImport((r as { report: Parameters<typeof describeImport>[0] }).report));
        router.refresh();
      });
    }}>
      <label className="block text-sm">CSV file (columns: Name, Email, Company, Phone; up to 500 rows)<input name="file" type="file" accept=".csv,text/csv" required className={field} /></label>
      <label className="flex items-start gap-2 text-sm">
        <input name="attested" type="checkbox" required className="mt-1" />
        <span>I confirm these are my own business contacts and I have the right to store them here. I will not email anyone who has not agreed to hear from me.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>Import contacts</button>
        {tooBig && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{crmFailureMessage("csv_too_big")}</p>}
        {note && !error && <span role="status" className="text-sm">{note}</span>}
        <Err error={error} />
      </div>
    </form>
  );
}

export function DeleteContactButton({ orgId, id }: { orgId: string; id: string }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className={btn} onClick={() => {
        if (!window.confirm("Delete this contact with its deals and notes? This cannot be undone.")) return;
        run(() => deleteContactAction({ orgId, id }), () => router.push("/crm"));
      }}>Delete contact</button>
      <Err error={error} />
    </div>
  );
}

export function AddDealForm({ orgId, contactId }: { orgId: string; contactId: string }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <form className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const amount = String(f.get("amount") ?? "").trim();
      const currency = String(f.get("currency") ?? "").trim();
      run(() => saveDealAction({
        orgId, contactId, title: String(f.get("title") ?? ""), stage: String(f.get("stage") ?? "lead"),
        ...(amount ? { value: Math.round(Number(amount) * 100), currency } : {}),
        ...(f.get("close") ? { expectedClose: String(f.get("close")) } : {}),
      }), () => { form.reset(); router.refresh(); });
    }}>
      <label className="block text-sm sm:col-span-2">Deal title<input name="title" required maxLength={200} className={field} /></label>
      <label className="block text-sm">Stage
        <select name="stage" defaultValue="lead" className={field}>{STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}</select>
      </label>
      <label className="block text-sm">Expected close<input name="close" type="date" className={field} /></label>
      <label className="block text-sm">Value (optional)<input name="amount" type="number" min={0} step="0.01" className={field} /></label>
      <label className="block text-sm">Currency (3-letter, needed with a value)<input name="currency" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" className={field} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={btn}>Add deal</button>
        <Err error={error} />
      </div>
    </form>
  );
}

/** The save RPC replaces the whole deal, so a stage change must resend every other field unchanged. */
export function DealStageSelect({ orgId, contactId, dealId, title, stage, value, currency, expectedClose }: { orgId: string; contactId: string; dealId: string; title: string; stage: string; value: number | null; currency: string | null; expectedClose: string | null }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label={`Stage for ${title}`} disabled={pending} defaultValue={stage} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
        onChange={(e) => run(() => saveDealAction({ orgId, contactId, id: dealId, title, stage: e.target.value, ...(value !== null && currency !== null ? { value, currency } : {}), ...(expectedClose ? { expectedClose } : {}) }), () => router.refresh())}>
        {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
      </select>
      <Err error={error} />
    </span>
  );
}

export function AddNoteForm({ orgId, contactId }: { orgId: string; contactId: string }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <form className="mt-3 max-w-xl space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const when = String(f.get("followUp") ?? "");
      run(() => addNoteAction({ orgId, contactId, body: String(f.get("body") ?? ""), ...(when ? { followUpAt: new Date(when).toISOString() } : {}) }), () => { form.reset(); router.refresh(); });
    }}>
      <label className="block text-sm">Note<textarea name="body" required maxLength={4000} rows={3} className={field} /></label>
      <label className="block text-sm">Follow up on (optional)<input name="followUp" type="datetime-local" className={field} /></label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>Add note</button>
        <Err error={error} />
      </div>
    </form>
  );
}

export function CompleteNoteButton({ orgId, contactId, noteId }: { orgId: string; contactId: string; noteId: string }) {
  const router = useRouter();
  const { pending, error, run } = useCrmAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={pending} className={btn} onClick={() => run(() => completeNoteAction({ orgId, contactId, noteId }), () => router.refresh())}>Mark done</button>
      <Err error={error} />
    </span>
  );
}

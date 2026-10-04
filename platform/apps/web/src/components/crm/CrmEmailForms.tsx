"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendCrmEmailAction, setContactBasisAction } from "@/app/(app)/crm-email-actions";
import { basisLabel, emailFailureMessage } from "@/lib/crm/present";
import type { EmailFailure } from "@/lib/crm/email";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

function useEmailAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const run = (fn: () => Promise<{ ok: true } | { ok: false; code: EmailFailure }>, onOk: () => void, okText = "") => start(async () => {
    setError(""); setDone("");
    try {
      const r = await fn();
      if (r.ok) { setDone(okText); onOk(); } else setError(emailFailureMessage(r.code));
    } catch {
      setError(emailFailureMessage("error"));
    }
  });
  return { pending, error, done, run };
}

export function BasisForm({ orgId, contactId, basis }: { orgId: string; contactId: string; basis: string | null }) {
  const router = useRouter();
  const { pending, error, done, run } = useEmailAction();
  return (
    <form className="mt-2 flex max-w-xl flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => setContactBasisAction({ orgId, contactId, basis: String(f.get("basis") ?? "") }), () => router.refresh(), "Saved.");
    }}>
      <label className="block text-sm">Why may you email this person?
        <select name="basis" defaultValue={basis ?? ""} className={field}>
          <option value="">Not recorded (cannot email)</option>
          {(["existing_client", "opted_in", "requested_contact"] as const).map((b) => <option key={b} value={b}>{basisLabel(b)}</option>)}
        </select>
      </label>
      <button disabled={pending} className={btn}>Save</button>
      {done && !error && <span role="status" className="text-sm">{done}</span>}
      <Err error={error} />
    </form>
  );
}

export function SendEmailForm({ orgId, contactId, to }: { orgId: string; contactId: string; to: string }) {
  const router = useRouter();
  const { pending, error, done, run } = useEmailAction();
  return (
    <form className="mt-3 max-w-xl space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      run(() => sendCrmEmailAction({ orgId, contactId, subject: String(f.get("subject") ?? ""), body: String(f.get("body") ?? "") }), () => { form.reset(); router.refresh(); }, "Sent.");
    }}>
      <p className="text-sm">To: {to}</p>
      <label className="block text-sm">Subject<input name="subject" required maxLength={200} className={field} /></label>
      <label className="block text-sm">Message (plain text)<textarea name="body" required maxLength={5000} rows={6} className={field} /></label>
      <p className="text-xs opacity-70">A footer with your legal name, address, why they are receiving this, and an unsubscribe link is added automatically. Replies go to the email address on your account. One message at a time.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "Sending…" : "Send email"}</button>
        {done && !error && <span role="status" className="text-sm">{done}</span>}
        <Err error={error} />
      </div>
    </form>
  );
}

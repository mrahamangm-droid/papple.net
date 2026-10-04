"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCredentialAction, requestCredentialCheckAction, saveCredentialAction } from "@/app/(app)/credential-actions";
import { credentialFailureMessage, KINDS, kindLabel, type CredentialFailure } from "@/lib/credentials/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

type Result = { ok: true } | { ok: false; code: CredentialFailure };
function useCredentialAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<Result>, onOk?: () => void) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); } else setError(credentialFailureMessage(r.code));
    } catch {
      setError(credentialFailureMessage("error"));
    }
  });
  return { pending, error, run };
}

export interface CredentialValues { id?: string; kind: string; title: string; issuer: string; identifier: string; issuedOn: string; expiresOn: string; evidenceUrl: string }

export function CredentialForm({ orgId, initial, onDone }: { orgId: string; initial?: CredentialValues; onDone?: () => void }) {
  const { pending, error, run } = useCredentialAction();
  const v = initial ?? { kind: "licence", title: "", issuer: "", identifier: "", issuedOn: "", expiresOn: "", evidenceUrl: "" };
  return (
    <form className="mt-2 grid max-w-2xl gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const g = (k: string) => String(f.get(k) ?? "");
      run(() => saveCredentialAction({ orgId, id: initial?.id, kind: g("kind"), title: g("title"), issuer: g("issuer"), identifier: g("identifier"), issuedOn: g("issuedOn"), expiresOn: g("expiresOn"), evidenceUrl: g("evidenceUrl") }), () => { if (!initial) form.reset(); onDone?.(); });
    }}>
      <label className="block text-sm">Type
        <select name="kind" defaultValue={v.kind} className={field}>{KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select>
      </label>
      <label className="block text-sm">Title
        <input name="title" required minLength={3} maxLength={160} defaultValue={v.title} className={field} />
      </label>
      <label className="block text-sm">Issued by
        <input name="issuer" required minLength={2} maxLength={160} defaultValue={v.issuer} className={field} />
      </label>
      <label className="block text-sm">Number or identifier <span className="opacity-70">(private, only reviewers see it)</span>
        <input name="identifier" maxLength={80} defaultValue={v.identifier} className={field} />
      </label>
      <label className="block text-sm">Issued on
        <input name="issuedOn" type="date" defaultValue={v.issuedOn} className={field} />
      </label>
      <label className="block text-sm">Expires on
        <input name="expiresOn" type="date" defaultValue={v.expiresOn} className={field} />
      </label>
      <label className="block text-sm sm:col-span-2">Evidence link <span className="opacity-70">(https://, private, only reviewers see it)</span>
        <input name="evidenceUrl" type="url" maxLength={500} defaultValue={v.evidenceUrl} className={field} />
      </label>
      <div className="sm:col-span-2">
        <button disabled={pending} className={btn}>{initial ? "Save changes" : "Add credential"}</button>
        <Err error={error} />
      </div>
    </form>
  );
}

export function RequestCheckForm({ orgId, id }: { orgId: string; id: string }) {
  const { pending, error, run } = useCredentialAction();
  const [note, setNote] = useState("");
  return (
    <form className="mt-2 flex max-w-xl flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => requestCredentialCheckAction({ orgId, id, note }), () => setNote("")); }}>
      <label className="block flex-1 text-sm">Note for the reviewer
        <input value={note} onChange={(e) => setNote(e.target.value)} minLength={10} maxLength={1000} required className={field} />
      </label>
      <button disabled={pending || note.trim().length < 10} className={btn}>Request a check</button>
      <Err error={error} />
    </form>
  );
}

export function DeleteCredentialButton({ orgId, id, title }: { orgId: string; id: string; title: string }) {
  const { pending, error, run } = useCredentialAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} onClick={() => { if (window.confirm(`Delete "${title}"?`)) run(() => deleteCredentialAction({ orgId, id })); }}>Delete</button>
      <Err error={error} />
    </span>
  );
}

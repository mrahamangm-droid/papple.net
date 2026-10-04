"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/settings/api-keys-actions";
import { apiKeyFailureMessage } from "@/lib/api/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";

export function CreateApiKeyForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const [copied, setCopied] = useState("");
  return (
    <div>
      <form className="mt-2 grid max-w-xl gap-3" onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const name = String(new FormData(form).get("name") ?? "");
        start(async () => {
          setError(""); setSecret(null);
          try {
            const r = await createApiKeyAction({ orgId, name });
            if (r.ok) { setSecret({ value: r.secret, name: name.trim() }); form.reset(); router.refresh(); } else setError(apiKeyFailureMessage(r.code));
          } catch {
            setError(apiKeyFailureMessage("error"));
          }
        });
      }}>
        <label className="block text-sm">Key name
          <input name="name" required maxLength={60} className={field} placeholder="For example: Finance dashboard" />
        </label>
        <div><button disabled={pending} className={btn}>Create key</button></div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </form>
      {secret && (
        <div className="mt-4 max-w-xl rounded-lg border border-neutral-400 p-4 text-sm">
          <p role="status" className="font-medium">Your new key “{secret.name}” is ready. Copy it now: it is shown only once and PAPple cannot show it again.</p>
          <p className="mt-2 break-all rounded bg-neutral-100 p-2 font-mono dark:bg-neutral-900" data-testid="new-api-key">{secret.value}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} onClick={() => {
              const w = navigator.clipboard?.writeText(secret.value);
              if (!w) { setCopied("Copying is not available here. Select the key above and copy it by hand."); return; }
              w.then(() => setCopied("Copied."), () => setCopied("Copying failed. Select the key above and copy it by hand."));
            }}>Copy key</button>
            <button type="button" className={btn} onClick={() => { setSecret(null); setCopied(""); }}>I have saved it</button>
          </div>
          <p role="status" className="mt-2">{copied}</p>
        </div>
      )}
    </div>
  );
}

export function RevokeApiKeyButton({ orgId, id, name }: { orgId: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span>
      <button type="button" disabled={pending} className={btn} onClick={() => {
        if (!window.confirm(`Revoke the key "${name}"? Anything using it stops working immediately. This cannot be undone.`)) return;
        start(async () => {
          setError("");
          try {
            const r = await revokeApiKeyAction({ orgId, id });
            if (r.ok) router.refresh(); else setError(apiKeyFailureMessage(r.code));
          } catch {
            setError(apiKeyFailureMessage("error"));
          }
        });
      }} aria-label={`Revoke ${name}`}>Revoke</button>
      {error && <span role="alert" className="block text-sm text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

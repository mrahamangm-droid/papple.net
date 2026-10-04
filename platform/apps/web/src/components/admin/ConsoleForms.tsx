"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewCredentialAction, revokeCredentialAction, dismissReportAction, reviewVerificationAction, revokeVerificationAction, saveCategoryAction, saveSkillAction, setVisibilityAction, setFlagAction, setOrgStatusAction, setPlatformRoleAction, setSettingAction, updatePlanAction } from "@/app/(app)/admin/actions";
import { requestVerificationAction } from "@/app/(app)/settings/verification/actions";
import { FormError, fieldClass } from "@/components/marketplace/useAction";
import type { ConsoleResult } from "@/lib/admin/actions";
import { messageFor } from "@/lib/marketplace/result-messages";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";

/** Runs a console action. A thrown error (not signed in, not an admin) becomes calm copy; failures never echo server text. */
function useConsole() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const run = (fn: () => Promise<ConsoleResult>) =>
    start(async () => {
      setError(""); setDone(false);
      try {
        const r = await fn();
        if (!r.ok) { setError(messageFor(r)); return; }
        setDone(true);
        router.refresh();
      } catch {
        setError(messageFor({ ok: false, code: "forbidden" }));
      }
    });
  return { pending, error, done, run };
}

function Reason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">Reason (recorded in the audit log, 10 to 1000 characters)
      <input className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)} minLength={10} maxLength={1000} required />
    </label>
  );
}
const Saved = ({ done }: { done: boolean }) => (done ? <p role="status" className="text-sm">Saved.</p> : null);

export function SettingForm({ settingKey, label, help, current, risky }: { settingKey: string; label: string; help: string; current: string; risky: boolean }) {
  const [raw, setRaw] = useState(current);
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        let value: unknown;
        try { value = JSON.parse(raw); } catch { return run(async () => ({ ok: false, code: "invalid" })); }
        if (risky && !window.confirm(`${label} affects live payments. Continue?`)) return;
        run(() => setSettingAction({ key: settingKey, value, reason }));
      }}
    >
      <label className="block text-sm font-medium">{label}
        <input className={fieldClass} value={raw} onChange={(e) => setRaw(e.target.value)} required />
      </label>
      {help && <p className="text-xs opacity-70">{help}</p>}
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>Save</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function FlagForm({ flagKey, enabled, description }: { flagKey: string; enabled: boolean; description: string }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => setFlagAction({ key: flagKey, enabled: !enabled, reason })); }}>
      <p className="text-sm"><span className="font-medium">{flagKey}</span> is <strong>{enabled ? "on" : "off"}</strong>. {description}</p>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>{enabled ? "Turn off" : "Turn on"}</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function PlanForm({ plan }: { plan: { key: string; name: string; price_cents: number | null; active: boolean; limits: unknown; features: unknown } }) {
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(plan.price_cents === null ? "" : String(plan.price_cents));
  const [active, setActive] = useState(plan.active);
  const [limits, setLimits] = useState(JSON.stringify(plan.limits));
  const [features, setFeatures] = useState(JSON.stringify(plan.features));
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        let l: unknown, f: unknown;
        try { l = JSON.parse(limits); f = JSON.parse(features); } catch { return run(async () => ({ ok: false, code: "invalid" })); }
        run(() => updatePlanAction({ key: plan.key, name, priceCents: price.trim() === "" ? null : Number(price), active, limits: l, features: f, reason }));
      }}
    >
      <label className="block text-sm">Name<input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
      <label className="block text-sm">Price in minor units (empty = custom pricing)<input className={fieldClass} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="block text-sm"><input type="checkbox" className="mr-2" checked={active} onChange={(e) => setActive(e.target.checked)} />Active (visible to customers)</label>
      <label className="block text-sm">Limits (JSON object)<textarea className={fieldClass} rows={2} value={limits} onChange={(e) => setLimits(e.target.value)} /></label>
      <label className="block text-sm">Features (JSON object)<textarea className={fieldClass} rows={2} value={features} onChange={(e) => setFeatures(e.target.value)} /></label>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>Save plan</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function OrgStatusForm({ orgId, name, status }: { orgId: string; name: string; status: "active" | "suspended" }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  const next = status === "active" ? "suspended" : "active";
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (next === "suspended" && !window.confirm(`Suspend ${name}? Its members lose access until it is restored. Counterparties keep access to shared contracts.`)) return;
        run(() => setOrgStatusAction({ orgId, status: next, reason }));
      }}
    >
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>{next === "suspended" ? "Suspend" : "Restore"}</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function RoleForm({ userId, role, grant }: { userId?: string; role?: "admin" | "support"; grant: boolean }) {
  const [uid, setUid] = useState(userId ?? "");
  const [r, setR] = useState<"admin" | "support">(role ?? "support");
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm(grant ? `Give this person the ${r} role?` : `Remove the ${r} role?`)) return;
        run(() => setPlatformRoleAction({ userId: uid, role: r, grant, reason }));
      }}
    >
      {!userId && <label className="block text-sm">User id<input className={fieldClass} value={uid} onChange={(e) => setUid(e.target.value)} required /></label>}
      {!role && (
        <label className="block text-sm">Role
          <select className={fieldClass} value={r} onChange={(e) => setR(e.target.value as "admin" | "support")}><option value="support">support</option><option value="admin">admin</option></select>
        </label>
      )}
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>{grant ? "Grant role" : "Remove role"}</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function ReviewForm({ requestId }: { requestId: string }) {
  const [note, setNote] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
      <label className="block text-sm">Decision note (shared with the organization; 10 to 1000 characters)
        <textarea className={fieldClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} minLength={10} maxLength={1000} required />
      </label>
      <div className="flex gap-2">
        <button disabled={pending || note.trim().length < 10} className={btn} onClick={() => run(() => reviewVerificationAction({ requestId, decision: "approved", note }))}>Approve</button>
        <button disabled={pending || note.trim().length < 10} className={btn} onClick={() => run(() => reviewVerificationAction({ requestId, decision: "rejected", note }))}>Reject</button>
      </div>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function RevokeForm({ orgId }: { orgId: string }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (window.confirm("Remove the Verified badge?")) run(() => revokeVerificationAction({ orgId, reason })); }}>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>Revoke verification</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function RequestVerificationForm({ orgId }: { orgId: string }) {
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => requestVerificationAction({ orgId, note, url })); }}>
      <label className="block text-sm">What evidence can we review? (10 to 1000 characters)
        <textarea className={fieldClass} rows={4} value={note} onChange={(e) => setNote(e.target.value)} minLength={10} maxLength={1000} required />
      </label>
      <label className="block text-sm">Link to the evidence (optional, https only)
        <input className={fieldClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} pattern="https://.*" />
      </label>
      <button disabled={pending || note.trim().length < 10} className={btn}>Request verification</button>
      <FormError error={error} />{done && <p role="status" className="text-sm">Request sent. We will notify you when it is reviewed.</p>}
    </form>
  );
}

export function VisibilityForm({ kind, id, hidden }: { kind: "profile" | "service" | "project"; id: string; hidden: boolean }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (window.confirm(hidden ? "Hide this from the marketplace?" : "Restore this? Services and projects come back as drafts for their owner to republish.")) run(() => setVisibilityAction({ kind, id, hidden, reason })); }}>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>{hidden ? "Hide" : "Restore"}</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function DismissForm({ reportId }: { reportId: string }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => dismissReportAction({ reportId, reason })); }}>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>Dismiss report</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function TaxonomyForm({ kind, item, parents }: { kind: "category" | "skill"; item?: { id: string; slug: string; name: string; parentId: string | null; position: number; active: boolean }; parents: { id: string; name: string }[] }) {
  const [slug, setSlug] = useState(item?.slug ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [parentId, setParentId] = useState(item?.parentId ?? "");
  const [position, setPosition] = useState(String(item?.position ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  const id = item?.id ?? null;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const parent = parentId === "" ? null : parentId;
        run(() => kind === "category"
          ? saveCategoryAction({ id, slug: id ? undefined : slug, name, parentId: parent, position: Number(position), active, reason })
          : saveSkillAction({ id, slug: id ? undefined : slug, name, categoryId: parent, active, reason }));
      }}
    >
      {!id && <label className="block text-sm">Slug (lowercase letters, digits and dashes; cannot change later)<input className={fieldClass} value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]{2,60}" /></label>}
      <label className="block text-sm">Name<input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} /></label>
      <label className="block text-sm">{kind === "category" ? "Parent category (optional)" : "Category (optional)"}
        <select className={fieldClass} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">None</option>
          {parents.filter((p) => p.id !== id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {kind === "category" && <label className="block text-sm">Position<input className={fieldClass} inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} /></label>}
      <label className="block text-sm"><input type="checkbox" className="mr-2" checked={active} onChange={(e) => setActive(e.target.checked)} />Active (available for new use)</label>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>{id ? "Save" : `Add ${kind}`}</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function CredentialReviewForm({ credentialId, version }: { credentialId: string; version: number }) {
  const [note, setNote] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
      <label className="block text-sm">Decision note (shared with the organization; 10 to 1000 characters)
        <textarea className={fieldClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} minLength={10} maxLength={1000} required />
      </label>
      <div className="flex gap-2">
        <button disabled={pending || note.trim().length < 10} className={btn} onClick={() => run(() => reviewCredentialAction({ credentialId, version, decision: "approved", note }))}>Approve</button>
        <button disabled={pending || note.trim().length < 10} className={btn} onClick={() => run(() => reviewCredentialAction({ credentialId, version, decision: "rejected", note }))}>Reject</button>
      </div>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

export function CredentialRevokeForm({ credentialId }: { credentialId: string }) {
  const [reason, setReason] = useState("");
  const { pending, error, done, run } = useConsole();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (window.confirm("Remove the Checked status from this credential?")) run(() => revokeCredentialAction({ credentialId, reason })); }}>
      <Reason value={reason} onChange={setReason} />
      <button disabled={pending || reason.trim().length < 10} className={btn}>Revoke check</button>
      <FormError error={error} /><Saved done={done} />
    </form>
  );
}

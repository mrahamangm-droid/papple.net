"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  declineInvitationAction, deletePoolAction, inviteToProjectAction, removePoolMemberAction, savePoolAction, setPoolMemberAction,
} from "@/app/(app)/talent-actions";
import { parseTags, talentFailureMessage, type TalentFailure } from "@/lib/talent/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

type Result = { ok: true } | { ok: false; code: TalentFailure };
function useTalentAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const run = (fn: () => Promise<Result>, onOk?: () => void, doneText = "") => start(async () => {
    setError(""); setDone("");
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); setDone(doneText); router.refresh(); } else setError(talentFailureMessage(r.code));
    } catch {
      setError(talentFailureMessage("error"));
    }
  });
  return { pending, error, done, run };
}
const Done = ({ text }: { text: string }) => (text ? <p role="status" className="text-sm">{text}</p> : null);

export function CreatePoolForm({ orgId }: { orgId: string }) {
  const { pending, error, run } = useTalentAction();
  return (
    <form className="mt-2 grid max-w-xl gap-3" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      run(() => savePoolAction({ orgId, name: String(f.get("name") ?? ""), description: String(f.get("description") ?? "") }), () => form.reset());
    }}>
      <label className="block text-sm">Pool name
        <input name="name" required minLength={2} maxLength={60} className={field} placeholder="For example: Trusted designers" />
      </label>
      <label className="block text-sm">What is it for? <span className="opacity-70">(optional)</span>
        <input name="description" maxLength={300} className={field} />
      </label>
      <div><button disabled={pending} className={btn}>Create pool</button><Err error={error} /></div>
    </form>
  );
}

export function DeletePoolButton({ orgId, id, name }: { orgId: string; id: string; name: string }) {
  const { pending, error, run } = useTalentAction();
  const router = useRouter();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} onClick={() => { if (window.confirm(`Delete the pool "${name}"? The professionals stay on PAPple; only your list and notes are removed.`)) run(() => deletePoolAction({ orgId, id }), () => router.push(`/talent?org=${orgId}`)); }}>Delete pool</button>
      <Err error={error} />
    </span>
  );
}

export function AddMemberButton({ orgId, poolId, profileId, name }: { orgId: string; poolId: string; profileId: string; name: string }) {
  const { pending, error, done, run } = useTalentAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} aria-label={`Add ${name} to this pool`} onClick={() => run(() => setPoolMemberAction({ orgId, poolId, profileId, note: "", tags: [] }), undefined, "Added.")}>Add to pool</button>
      <Err error={error} /><Done text={done} />
    </span>
  );
}

export function MemberNoteForm({ orgId, poolId, profileId, name, note, tags }: { orgId: string; poolId: string; profileId: string; name: string; note: string; tags: string[] }) {
  const { pending, error, done, run } = useTalentAction();
  return (
    <form className="mt-2 grid max-w-xl gap-2" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => setPoolMemberAction({ orgId, poolId, profileId, note: String(f.get("note") ?? ""), tags: parseTags(String(f.get("tags") ?? "")) }), undefined, "Saved.");
    }}>
      <label className="block text-sm">Private note about {name} <span className="opacity-70">(only your organization sees this)</span>
        <textarea name="note" rows={2} maxLength={1000} defaultValue={note} className={field} />
      </label>
      <label className="block text-sm">Tags <span className="opacity-70">(comma separated, up to 10)</span>
        <input name="tags" defaultValue={tags.join(", ")} className={field} />
      </label>
      <div><button disabled={pending} className={btn} aria-label={`Save note and tags for ${name}`}>Save note and tags</button><Err error={error} /><Done text={done} /></div>
    </form>
  );
}

export function RemoveMemberButton({ orgId, poolId, profileId, name }: { orgId: string; poolId: string; profileId: string; name: string }) {
  const { pending, error, run } = useTalentAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} aria-label={`Remove ${name} from this pool`} onClick={() => { if (window.confirm(`Remove ${name} from this pool? Your note and tags for them in this pool are deleted.`)) run(() => removePoolMemberAction({ orgId, poolId, profileId })); }}>Remove</button>
      <Err error={error} />
    </span>
  );
}

export function InviteForm({ orgId, profileId, name, projects }: { orgId: string; profileId: string; name: string; projects: { id: string; title: string }[] }) {
  const { pending, error, done, run } = useTalentAction();
  if (projects.length === 0) return <p className="mt-2 text-sm">Publish an open project to invite {name}.</p>;
  return (
    <form className="mt-2 grid max-w-xl gap-2" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      run(() => inviteToProjectAction({ orgId, profileId, projectId: String(f.get("project") ?? ""), message: String(f.get("message") ?? "") }) as Promise<Result>, () => form.reset(), "Invitation sent.");
    }}>
      <label className="block text-sm">Project
        <select name="project" required className={field}>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      </label>
      <label className="block text-sm">Message to {name} <span className="opacity-70">(10 to 1000 characters; they see this and your organization name)</span>
        <textarea name="message" required minLength={10} maxLength={1000} rows={3} className={field} />
      </label>
      <div><button disabled={pending} className={btn} aria-label={`Send invitation to ${name}`}>Send invitation</button><Err error={error} /><Done text={done} /></div>
    </form>
  );
}

export function DeclineInvitationButton({ orgId, id, title }: { orgId: string; id: string; title: string }) {
  const { pending, error, run } = useTalentAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} aria-label={`Decline invitation to ${title}`} onClick={() => { if (window.confirm("Decline this invitation? You can still send a proposal to the project.")) run(() => declineInvitationAction({ orgId, id })); }}>Decline</button>
      <Err error={error} />
    </span>
  );
}

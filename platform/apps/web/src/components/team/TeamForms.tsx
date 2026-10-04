"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptInviteAction, inviteMemberAction, leaveOrganizationAction, removeMemberAction, revokeInviteAction, setMemberRoleAction } from "@/app/(app)/team-actions";
import { assignableRoles, roleLabel, teamFailureMessage, type TeamFailure } from "@/lib/team/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

type Result = { ok: true } | { ok: false; code: TeamFailure };

function useTeamAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<Result>, onOk?: () => void, onFail?: () => void) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); } else { setError(teamFailureMessage(r.code)); onFail?.(); }
    } catch {
      setError(teamFailureMessage("error"));
      onFail?.();
    }
  });
  return { pending, error, run };
}

export function InviteForm({ orgId, callerRole }: { orgId: string; callerRole: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ link: string; email: "sent" | "off" | "failed"; to: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const roles = assignableRoles(callerRole);
  return (
    <div>
      <form className="mt-2 flex max-w-xl flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const to = String(f.get("email") ?? "");
        start(async () => {
          setError(""); setCreated(null); setCopied(false);
          try {
            const r = await inviteMemberAction({ orgId, email: to, role: String(f.get("role") ?? "member") });
            if (r.ok) { setCreated({ link: r.link, email: r.email, to }); form.reset(); router.refresh(); } else setError(teamFailureMessage(r.code));
          } catch {
            setError(teamFailureMessage("error"));
          }
        });
      }}>
        <label className="block flex-1 text-sm">Email address
          <input name="email" type="email" required maxLength={254} autoComplete="off" className={field} />
        </label>
        <label className="block text-sm">Role
          <select name="role" defaultValue="member" className={field}>
            {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </label>
        <button disabled={pending} className={btn}>Create invite</button>
      </form>
      <Err error={error} />
      {created && (
        <div role="status" className="mt-3 max-w-xl rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700">
          <p>
            {created.email === "sent" ? `We emailed ${created.to}. ` : created.email === "failed" ? `The email to ${created.to} could not be sent. ` : ""}
            Share this link with them yourself if you like. It is shown only now, works once, and only for someone signed in with {created.to}.
          </p>
          <input readOnly value={created.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} />
          <button type="button" className={`${btn} mt-2`} onClick={async () => {
            try { await navigator.clipboard.writeText(created.link); setCopied(true); } catch { setCopied(false); }
          }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </div>
  );
}

export function RevokeInviteButton({ orgId, inviteId }: { orgId: string; inviteId: string }) {
  const { pending, error, run } = useTeamAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} onClick={() => run(() => revokeInviteAction({ orgId, inviteId }))}>Revoke</button>
      <Err error={error} />
    </span>
  );
}

export function RoleSelect({ orgId, userId, role, options, self }: { orgId: string; userId: string; role: string; options: string[]; self: boolean }) {
  const { pending, error, run } = useTeamAction();
  const [value, setValue] = useState(role);
  // A role changes only on an explicit Save, never as a side effect of moving through the list with the keyboard.
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select aria-label="Role" disabled={pending} value={value} onChange={(e) => setValue(e.target.value)} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm">
        {options.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
      </select>
      {value !== role && (
        <>
          <button type="button" disabled={pending} className={btn} onClick={() => {
            if (self && !window.confirm(`Change your own role to ${roleLabel(value)}? You may not be able to change it back.`)) return;
            run(() => setMemberRoleAction({ orgId, userId, role: value }), undefined, () => setValue(role));
          }}>Save</button>
          <button type="button" disabled={pending} className={btn} onClick={() => setValue(role)}>Cancel</button>
        </>
      )}
      <Err error={error} />
    </span>
  );
}

export function RemoveMemberButton({ orgId, userId, label }: { orgId: string; userId: string; label: string }) {
  const { pending, error, run } = useTeamAction();
  return (
    <span>
      <button type="button" disabled={pending} className={btn} onClick={() => {
        if (window.confirm(`Remove ${label} from this organization? They lose access immediately.`)) run(() => removeMemberAction({ orgId, userId }));
      }}>Remove</button>
      <Err error={error} />
    </span>
  );
}

export function LeaveButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const { pending, error, run } = useTeamAction();
  return (
    <div className="mt-2">
      <button type="button" disabled={pending} className={btn} onClick={() => {
        if (window.confirm("Leave this organization? You lose access immediately.")) run(() => leaveOrganizationAction({ orgId }), () => router.push("/dashboard"));
      }}>Leave this organization</button>
      <Err error={error} />
    </div>
  );
}

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="mt-4">
      <button disabled={pending} className={btn} onClick={() => start(async () => {
        setError("");
        try {
          const r = await acceptInviteAction(token);
          if (r.ok) router.push(`/settings/team?org=${r.orgId}`); else setError(teamFailureMessage(r.code));
        } catch {
          setError(teamFailureMessage("error"));
        }
      })}>Join this organization</button>
      <Err error={error} />
    </div>
  );
}

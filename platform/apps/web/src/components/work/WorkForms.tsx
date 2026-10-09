"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  deleteFileAction, deleteTaskAction, deleteTimeAction, finishUploadAction, logTimeAction, saveTaskAction,
  setFileVisibilityAction, setTaskStatusAction, setTaskVisibilityAction, startUploadAction,
} from "@/app/(app)/work-actions";
import { TASK_STATUSES, taskStatusLabel, workFailureMessage, type WorkFailure } from "@/lib/work/present";

const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
const Err = ({ error }: { error: string }) => (error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null);

type Result = { ok: true } | { ok: false; code: WorkFailure; reason?: string };
function useWorkAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<Result>, onOk?: () => void) => start(async () => {
    setError("");
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); } else setError(workFailureMessage(r.code));
    } catch {
      setError(workFailureMessage("error"));
    }
  });
  return { pending, error, run, setError };
}

type Base = { orgId: string; contractId: string };

export function TaskForm({ orgId, contractId }: Base) {
  const { pending, error, run } = useWorkAction();
  return (
    <form className="mt-2 grid max-w-xl gap-3" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const due = String(f.get("due") ?? "");
      run(() => saveTaskAction({
        orgId, contractId, title: String(f.get("title") ?? ""), description: String(f.get("description") ?? ""),
        priority: String(f.get("priority") ?? "normal"), visibility: String(f.get("visibility") ?? "private"), ...(due ? { due } : {}),
      }), () => form.reset());
    }}>
      <label className="block text-sm">Task
        <input name="title" required maxLength={200} className={field} placeholder="For example: Send brand assets" />
      </label>
      <label className="block text-sm">Details <span className="opacity-70">(optional)</span>
        <textarea name="description" maxLength={2000} rows={2} className={field} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm">Priority
          <select name="priority" defaultValue="normal" className={field}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
        </label>
        <label className="block text-sm">Due <span className="opacity-70">(optional)</span>
          <input name="due" type="date" className={field} />
        </label>
        <label className="block text-sm">Who sees it
          <select name="visibility" defaultValue="private" className={field}><option value="private">Only my organization</option><option value="shared">Both parties</option></select>
        </label>
      </div>
      <div><button disabled={pending} className={btn}>Add task</button><Err error={error} /></div>
    </form>
  );
}

export function TaskControls({ orgId, contractId, id, title, status, visibility }: Base & { id: string; title: string; status: string; visibility: string }) {
  const { pending, error, run } = useWorkAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="text-sm"><span className="sr-only">Status of {title}</span>
        <select disabled={pending} value={status} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
          onChange={(e) => run(() => setTaskStatusAction({ orgId, contractId, id, status: e.target.value }))}>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{taskStatusLabel(s)}</option>)}
        </select>
      </label>
      <button type="button" disabled={pending} className={btn} aria-label={`${visibility === "shared" ? "Make private" : "Share"}: ${title}`}
        onClick={() => run(() => setTaskVisibilityAction({ orgId, contractId, id, visibility: visibility === "shared" ? "private" : "shared" }))}>
        {visibility === "shared" ? "Make private" : "Share"}
      </button>
      <button type="button" disabled={pending} className={btn} aria-label={`Delete task: ${title}`}
        onClick={() => { if (window.confirm(`Delete the task "${title}"?`)) run(() => deleteTaskAction({ orgId, contractId, id })); }}>Delete</button>
      <Err error={error} />
    </span>
  );
}

export function TimeForm({ orgId, contractId, tasks }: Base & { tasks: { id: string; title: string }[] }) {
  const { pending, error, run } = useWorkAction();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; // the user's own calendar day, not UTC
  return (
    <form className="mt-2 grid max-w-xl gap-3" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const task = String(f.get("task") ?? "");
      const hours = Number(f.get("hours") || 0);
      const mins = Number(f.get("mins") || 0);
      run(() => logTimeAction({ orgId, contractId, date: String(f.get("date") ?? today), minutes: Math.round(hours * 60 + mins), note: String(f.get("note") ?? ""), ...(task ? { taskId: task } : {}) }), () => form.reset());
    }}>
      <div className="grid grid-cols-4 gap-3">
        <label className="block text-sm">Date<input name="date" type="date" required defaultValue={today} className={field} /></label>
        <label className="block text-sm">Hours<input name="hours" type="number" min={0} max={23} step={1} defaultValue={0} className={field} /></label>
        <label className="block text-sm">Minutes<input name="mins" type="number" min={0} max={59} step={1} defaultValue={0} className={field} /></label>
        <label className="block text-sm">Task <span className="opacity-70">(optional)</span>
          <select name="task" defaultValue="" className={field}><option value="">None</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
        </label>
      </div>
      <label className="block text-sm">Note <span className="opacity-70">(optional)</span><input name="note" maxLength={300} className={field} /></label>
      <p className="text-sm opacity-70">Time records are always private to your organization.</p>
      <div><button disabled={pending} className={btn}>Log time</button><Err error={error} /></div>
    </form>
  );
}

export function DeleteTimeButton({ orgId, contractId, id }: Base & { id: string }) {
  const { pending, error, run } = useWorkAction();
  return <span><button type="button" disabled={pending} className={btn} aria-label="Delete this time record" onClick={() => { if (window.confirm("Delete this time record?")) run(() => deleteTimeAction({ orgId, contractId, id })); }}>Delete</button><Err error={error} /></span>;
}

export function FileUploader({ orgId, contractId }: Base) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) { setError("Choose a file first."); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const start = await startUploadAction({ orgId, contractId, name: file.name, mime: file.type, size: file.size, visibility });
      if (!start.ok) { setError(start.code === "file" && start.reason ? `${workFailureMessage("file")} (${start.reason})` : workFailureMessage(start.code)); return; }
      const put = await fetch(start.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) {
        // The pending row is removed by deleting it; if the browser cannot reach storage the file simply never appears.
        await deleteFileAction({ orgId, contractId, id: start.fileId });
        setError(workFailureMessage("error")); return;
      }
      const fin = await finishUploadAction({ orgId, contractId, fileId: start.fileId });
      if (!fin.ok) { setError(fin.code === "file" && fin.reason ? `${workFailureMessage("file")} (${fin.reason})` : workFailureMessage(fin.code)); return; }
      if (input.current) input.current.value = "";
      setNote("Uploaded.");
      router.refresh();
    } catch {
      setError(workFailureMessage("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 grid max-w-xl gap-3">
      <label className="block text-sm">File <span className="opacity-70">(PDF, PNG, JPG, WebP, DOCX or XLSX, up to 10 MB)</span>
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" className={field} />
      </label>
      <label className="block text-sm">Who sees it
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "shared")} className={field}>
          <option value="private">Only my organization</option><option value="shared">Both parties</option>
        </select>
      </label>
      <p className="text-sm opacity-70">Files are checked for type and size. They are not scanned for viruses.</p>
      <div><button type="button" disabled={busy} className={btn} onClick={upload}>{busy ? "Uploading…" : "Upload"}</button>
        <Err error={error} />{note && <p role="status" className="text-sm">{note}</p>}</div>
    </div>
  );
}

export function FileControls({ orgId, contractId, id, name, visibility, status, readOnly }: Base & { id: string; name: string; visibility: string; status: string; readOnly: boolean }) {
  const { pending, error, run } = useWorkAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {status === "ready" && !readOnly && (
        <button type="button" disabled={pending} className={btn} aria-label={`${visibility === "shared" ? "Make private" : "Share"}: ${name}`}
          onClick={() => run(() => setFileVisibilityAction({ orgId, contractId, id, visibility: visibility === "shared" ? "private" : "shared" }))}>
          {visibility === "shared" ? "Make private" : "Share"}
        </button>
      )}
      <button type="button" disabled={pending} className={btn} aria-label={`Delete file: ${name}`}
        onClick={() => { if (window.confirm(`Delete "${name}"? This cannot be undone.`)) run(() => deleteFileAction({ orgId, contractId, id })); }}>Delete</button>
      <Err error={error} />
    </span>
  );
}

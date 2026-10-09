import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { DeleteTimeButton, FileControls, FileUploader, TaskControls, TaskForm, TimeForm } from "@/components/work/WorkForms";
import { requireCapability } from "@/lib/auth-context";
import { viewerSide } from "@/lib/contracts/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatBytes, formatMinutes, priorityLabel, taskStatusLabel, visibilityLabel } from "@/lib/work/present";

export const metadata = { title: "Contract work", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "member"];

export default async function ContractWorkPage({ params }: PageProps<"/contracts/[id]/work">) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data: c } = await db.from("contracts").select("id, title, status, client_org_id, provider_org_id").eq("id", id).maybeSingle();
  if (!c) notFound();
  const view = viewerSide(c as { client_org_id: string; provider_org_id: string }, ctx.memberships.map((m) => ({ id: m.orgId, role: m.role })));
  if (!view) notFound(); // only the two sides work here
  const isWriter = WRITERS.includes(view.role);
  const canWrite = isWriter && c.status !== "cancelled"; // files can still be deleted on a cancelled contract so storage can be freed

  const [{ data: tasks }, { data: time }, { data: files }, { data: orgs }] = await Promise.all([
    db.from("tasks").select("id, org_id, title, description, status, priority, due_date, visibility, created_at").eq("contract_id", id).order("created_at"),
    db.from("time_entries").select("id, task_id, work_date, minutes, note").eq("contract_id", id).eq("org_id", view.orgId).order("work_date", { ascending: false }),
    db.from("contract_files").select("id, org_id, name, size_bytes, visibility, status, created_at").eq("contract_id", id).order("created_at", { ascending: false }),
    db.from("organizations").select("id, name").in("id", [c.client_org_id as string, c.provider_org_id as string]),
  ]);
  const nameOf = (orgId: string) => (orgs ?? []).find((o) => o.id === orgId)?.name as string | undefined;
  const mine = <T extends { org_id: unknown }>(r: T) => r.org_id === view.orgId;
  const myTasks = (tasks ?? []).filter(mine);
  const theirTasks = (tasks ?? []).filter((t) => !mine(t));
  const myFiles = (files ?? []).filter(mine);
  const theirFiles = (files ?? []).filter((f) => !mine(f));
  const totalMinutes = (time ?? []).reduce((n, t) => n + (t.minutes as number), 0);
  const taskTitle = new Map((tasks ?? []).map((t) => [t.id as string, t.title as string]));

  return (
    <AppShell ctx={ctx}>
      <p className="text-sm"><Link className="underline" href={`/contracts/${id}`}>Back to the contract</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">Work: {c.title as string}</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-70">
        Tasks and files are private to your organization until you share them. Anything the other party shares with you appears below as read-only.
        {c.status === "cancelled" && " This contract is cancelled, so the work is read-only."}
      </p>

      <section className="mt-8" aria-label="Tasks">
        <h2 className="text-lg font-semibold">Your tasks</h2>
        <ul className="mt-3 max-w-3xl space-y-3">
          {myTasks.map((t) => (
            <li key={t.id as string}>
              <Card>
                <p className="font-medium">{t.title as string}</p>
                {t.description ? <p className="mt-1 text-sm">{t.description as string}</p> : null}
                <p className="mt-1 text-sm opacity-70">
                  {taskStatusLabel(t.status as string)} · {priorityLabel(t.priority as string)} priority{t.due_date ? ` · due ${t.due_date as string}` : ""} · {visibilityLabel(t.visibility as string)}
                </p>
                {canWrite && (
                  <div className="mt-2">
                    <TaskControls orgId={view.orgId} contractId={id} id={t.id as string} title={t.title as string} status={t.status as string} visibility={t.visibility as string} />
                  </div>
                )}
              </Card>
            </li>
          ))}
          {myTasks.length === 0 && <li className="text-sm">No tasks yet.</li>}
        </ul>
        {canWrite && <div className="mt-4"><h3 className="text-base font-semibold">Add a task</h3><TaskForm orgId={view.orgId} contractId={id} /></div>}

        <h3 className="mt-8 text-base font-semibold">Shared by {nameOf(view.side === "client" ? (c.provider_org_id as string) : (c.client_org_id as string)) ?? "the other party"}</h3>
        <ul className="mt-3 max-w-3xl space-y-3">
          {theirTasks.map((t) => (
            <li key={t.id as string}>
              <Card>
                <p className="font-medium">{t.title as string}</p>
                {t.description ? <p className="mt-1 text-sm">{t.description as string}</p> : null}
                <p className="mt-1 text-sm opacity-70">{taskStatusLabel(t.status as string)} · {priorityLabel(t.priority as string)} priority{t.due_date ? ` · due ${t.due_date as string}` : ""}</p>
              </Card>
            </li>
          ))}
          {theirTasks.length === 0 && <li className="text-sm">Nothing shared with you yet.</li>}
        </ul>
      </section>

      <section className="mt-10" aria-label="Files">
        <h2 className="text-lg font-semibold">Your files</h2>
        <ul className="mt-3 max-w-3xl space-y-3">
          {myFiles.map((f) => (
            <li key={f.id as string}>
              <Card>
                <p className="font-medium">
                  {f.status === "ready"
                    ? <a className="underline" href={`/api/work/files/${f.id as string}`}>{f.name as string}</a>
                    : <>{f.name as string} <span className="text-sm opacity-70">(upload not finished)</span></>}
                </p>
                <p className="mt-1 text-sm opacity-70">{formatBytes(f.size_bytes as number)} · {visibilityLabel(f.visibility as string)}</p>
                {isWriter && <div className="mt-2"><FileControls orgId={view.orgId} contractId={id} id={f.id as string} name={f.name as string} visibility={f.visibility as string} status={f.status as string} readOnly={!canWrite} /></div>}
              </Card>
            </li>
          ))}
          {myFiles.length === 0 && <li className="text-sm">No files yet.</li>}
        </ul>
        {canWrite && <div className="mt-4"><h3 className="text-base font-semibold">Upload a file</h3><FileUploader orgId={view.orgId} contractId={id} /></div>}

        <h3 className="mt-8 text-base font-semibold">Shared by {nameOf(view.side === "client" ? (c.provider_org_id as string) : (c.client_org_id as string)) ?? "the other party"}</h3>
        <ul className="mt-3 max-w-3xl space-y-3">
          {theirFiles.map((f) => (
            <li key={f.id as string}><Card><p className="font-medium"><a className="underline" href={`/api/work/files/${f.id as string}`}>{f.name as string}</a></p>
              <p className="mt-1 text-sm opacity-70">{formatBytes(f.size_bytes as number)}</p></Card></li>
          ))}
          {theirFiles.length === 0 && <li className="text-sm">Nothing shared with you yet.</li>}
        </ul>
      </section>

      <section className="mt-10" aria-label="Time">
        <h2 className="text-lg font-semibold">Your time</h2>
        <p className="mt-1 text-sm opacity-70">Only your organization sees these records. Total: {formatMinutes(totalMinutes)}.</p>
        <ul className="mt-3 max-w-3xl space-y-2">
          {(time ?? []).map((t) => (
            <li key={t.id as string} className="flex flex-wrap items-center gap-3 text-sm">
              <span>{t.work_date as string} · {formatMinutes(t.minutes as number)}{t.task_id && taskTitle.get(t.task_id as string) ? ` · ${taskTitle.get(t.task_id as string)}` : ""}{t.note ? ` · ${t.note as string}` : ""}</span>
              {canWrite && <DeleteTimeButton orgId={view.orgId} contractId={id} id={t.id as string} />}
            </li>
          ))}
          {(time ?? []).length === 0 && <li className="text-sm">No time logged yet.</li>}
        </ul>
        {canWrite && <div className="mt-4"><h3 className="text-base font-semibold">Log time</h3><TimeForm orgId={view.orgId} contractId={id} tasks={myTasks.map((t) => ({ id: t.id as string, title: t.title as string }))} /></div>}
      </section>
    </AppShell>
  );
}

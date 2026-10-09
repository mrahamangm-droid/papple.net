import { z } from "zod";
import { objectKey } from "../storage";
import { validateUploadMeta, type UploadCheck } from "../file-validation";
import { TASK_STATUSES, type WorkFailure } from "./present";

export type { WorkFailure };
export type IdResult = { ok: true; id: string } | { ok: false; code: WorkFailure };
export type DoneResult = { ok: true } | { ok: false; code: WorkFailure; reason?: string };
export type StartResult = { ok: true; fileId: string; url: string } | { ok: false; code: WorkFailure; reason?: string };
export type DownloadResult = { ok: true; url: string; name: string } | { ok: false; code: WorkFailure };

export interface WorkDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may do what. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
  storage: {
    signUploadUrl: (key: string, mime: string, size: number) => Promise<string>;
    signDownloadUrl: (key: string) => Promise<string>;
  };
  /** Re-reads the stored bytes; deletes the object itself when they do not match. */
  verify: (key: string, declared: { name: string; declaredMime: string; expectedSize: number }) => Promise<UploadCheck>;
  removeObject: (key: string) => Promise<void>;
  /** Records, as the server, that the stored bytes were checked. Only the service role can do this; file_confirm refuses an upload without it. */
  markVerified: (fileId: string, size: number) => Promise<{ error: { code?: string } | null }>;
  newId: () => string;
}

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const visibility = z.enum(["private", "shared"]);
const taskInput = z.object({
  orgId: id, contractId: id, id: id.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assigneeId: id.optional(), due: date.optional(), milestoneId: id.optional(),
  visibility: visibility.optional(),
});
const taskRef = z.object({ orgId: id, contractId: id.optional(), id });
const statusInput = taskRef.extend({ status: z.enum(TASK_STATUSES) });
const timeInput = z.object({
  orgId: id, contractId: id, taskId: id.optional(), date,
  minutes: z.number().int().min(1).max(1440), note: z.string().trim().max(300).optional(),
});
const startInput = z.object({ orgId: id, contractId: id, name: z.string().min(1).max(255), mime: z.string().max(100), size: z.number().int(), visibility: visibility.optional() });
const finishInput = z.object({ orgId: id, contractId: id, fileId: id });
const visInput = taskRef.extend({ visibility });

const failure = (code?: string): WorkFailure =>
  code === "42501" ? "forbidden" : code === "22023" ? "invalid" : code === "54000" ? "limit" : code === "23505" ? "duplicate" : "error";

export function createWorkService(deps: WorkDeps) {
  const page = (contractId?: string) => (contractId ? [`/contracts/${contractId}/work`] : []);

  async function gate(): Promise<{ ok: true } | { ok: false; code: WorkFailure }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true };
  }
  async function call(fn: string, args: Record<string, unknown>, paths: string[] = []): Promise<{ ok: true; data: unknown } | { ok: false; code: WorkFailure }> {
    try {
      const { data, error } = await deps.rpc(fn, args);
      if (error) return { ok: false, code: failure(error.code) };
      for (const p of paths) deps.revalidate(p);
      return { ok: true, data };
    } catch {
      return { ok: false, code: "error" };
    }
  }
  async function run<S extends z.ZodType>(raw: unknown, schema: S, fn: string, args: (v: z.infer<S>) => Record<string, unknown>, paths: (v: z.infer<S>) => string[]) {
    const p = schema.safeParse(raw);
    if (!p.success) return { ok: false as const, code: "invalid" as WorkFailure };
    const g = await gate();
    if (!g.ok) return g;
    return call(fn, args(p.data), paths(p.data));
  }
  const toDone = (r: Awaited<ReturnType<typeof run>>): DoneResult => (r.ok ? { ok: true } : { ok: false, code: r.code });
  const toId = (r: Awaited<ReturnType<typeof run>>): IdResult =>
    !r.ok ? { ok: false, code: r.code } : typeof r.data === "string" ? { ok: true, id: r.data } : { ok: false, code: "error" };
  const dropPending = (orgId: string, fileId: string) => call("file_delete", { p_org: orgId, p_id: fileId });

  return {
    async saveTask(raw: unknown): Promise<IdResult> {
      return toId(await run(raw, taskInput, "task_save", (v) => ({
        p_org: v.orgId, p_contract: v.contractId, p_id: v.id ?? null, p_title: v.title, p_description: v.description ?? "",
        p_priority: v.priority ?? "normal", p_assignee: v.assigneeId ?? null, p_due: v.due ?? null,
        p_milestone: v.milestoneId ?? null, p_visibility: v.visibility ?? "private",
      }), (v) => page(v.contractId)));
    },
    async setTaskStatus(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, statusInput, "task_set_status", (v) => ({ p_org: v.orgId, p_id: v.id, p_status: v.status }), (v) => page(v.contractId)));
    },
    async deleteTask(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, taskRef, "task_delete", (v) => ({ p_org: v.orgId, p_id: v.id }), (v) => page(v.contractId)));
    },
    async setTaskVisibility(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, visInput, "task_set_visibility", (v) => ({ p_org: v.orgId, p_id: v.id, p_visibility: v.visibility }), (v) => page(v.contractId)));
    },
    async logTime(raw: unknown): Promise<IdResult> {
      return toId(await run(raw, timeInput, "time_log", (v) => ({
        p_org: v.orgId, p_contract: v.contractId, p_task: v.taskId ?? null, p_date: v.date, p_minutes: v.minutes, p_note: v.note ?? "",
      }), (v) => page(v.contractId)));
    },
    async deleteTime(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, taskRef, "time_delete", (v) => ({ p_org: v.orgId, p_id: v.id }), (v) => page(v.contractId)));
    },

    /** Step 1 of an upload: check the declaration, register a pending file, hand back a short-lived upload URL. */
    async startUpload(raw: unknown): Promise<StartResult> {
      const p = startInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const v = p.data;
      const meta = validateUploadMeta({ name: v.name, size: v.size, declaredMime: v.mime });
      if (!meta.ok) return { ok: false, code: "file", reason: meta.reason };
      const g = await gate();
      if (!g.ok) return g;
      const fileId = deps.newId();
      const key = objectKey(v.orgId, fileId, meta.ext);
      const reg = await call("file_register", {
        p_org: v.orgId, p_contract: v.contractId, p_id: fileId, p_name: v.name, p_mime: meta.mime,
        p_size: v.size, p_key: key, p_visibility: v.visibility ?? "private",
      });
      if (!reg.ok) return reg;
      try {
        const url = await deps.storage.signUploadUrl(key, meta.mime, v.size);
        return { ok: true, fileId, url };
      } catch {
        await dropPending(v.orgId, fileId);
        return { ok: false, code: "error" };
      }
    },
    /** Step 3: the browser has PUT the bytes. Re-check what was actually stored, then make the file visible. */
    async finishUpload(raw: unknown): Promise<DoneResult> {
      const p = finishInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const v = p.data;
      const g = await gate();
      if (!g.ok) return g;
      const k = await call("file_pending_key", { p_org: v.orgId, p_id: v.fileId });
      if (!k.ok) return k;
      const row = Array.isArray(k.data) ? (k.data[0] as { object_key?: string; name?: string; mime?: string; size_bytes?: number | string } | undefined) : undefined;
      const size = Number(row?.size_bytes);
      if (!row?.object_key || !row.name || !row.mime || !Number.isInteger(size)) return { ok: false, code: "error" };
      // The key, name, type and size come from the row the server registered, never from the browser.
      let check: UploadCheck;
      try {
        check = await deps.verify(row.object_key, { name: row.name, declaredMime: row.mime, expectedSize: size });
      } catch {
        return { ok: false, code: "error" };
      }
      if (!check.ok) {
        await dropPending(v.orgId, v.fileId);
        return { ok: false, code: "file", reason: check.reason };
      }
      try {
        const m = await deps.markVerified(v.fileId, size);
        if (m.error) return { ok: false, code: failure(m.error.code) };
      } catch {
        return { ok: false, code: "error" };
      }
      const done = await call("file_confirm", { p_org: v.orgId, p_id: v.fileId }, page(v.contractId));
      return done.ok ? { ok: true } : done;
    },
    async deleteFile(raw: unknown): Promise<DoneResult> {
      const r = await run(raw, taskRef, "file_delete", (v) => ({ p_org: v.orgId, p_id: v.id }), (v) => page(v.contractId));
      if (!r.ok) return { ok: false, code: r.code };
      if (typeof r.data === "string") {
        try { await deps.removeObject(r.data); } catch { /* the row is gone; a stray object is unreachable and harmless */ }
      }
      return { ok: true };
    },
    async setFileVisibility(raw: unknown): Promise<DoneResult> {
      return toDone(await run(raw, visInput, "file_set_visibility", (v) => ({ p_org: v.orgId, p_id: v.id, p_visibility: v.visibility }), (v) => page(v.contractId)));
    },
    /** The database decides who may read the file; only then is a five-minute URL minted. */
    async authorizeDownload(raw: unknown): Promise<DownloadResult> {
      const p = z.object({ id }).safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      const a = await call("file_authorize", { p_file: p.data.id });
      if (!a.ok) return a;
      const row = Array.isArray(a.data) ? (a.data[0] as { object_key?: string; name?: string } | undefined) : undefined;
      if (!row?.object_key || !row.name) return { ok: false, code: "error" };
      try {
        return { ok: true, url: await deps.storage.signDownloadUrl(row.object_key), name: row.name };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}

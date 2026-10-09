import { describe, expect, it, vi } from "vitest";
import { createWorkService, type WorkDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const CON = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const PDF = { orgId: ORG, contractId: CON, name: "brief.pdf", mime: "application/pdf", size: 1000, visibility: "private" };

function setup(over: Partial<WorkDeps> = {}) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null as unknown, error: null as { code?: string } | null }));
  const revalidate = vi.fn();
  const signUploadUrl = vi.fn(async (_k: string, _m: string, _s: number) => "https://r2/put");
  const signDownloadUrl = vi.fn(async (_k: string) => "https://r2/get");
  const verify = vi.fn(async () => ({ ok: true as const, ext: "pdf", mime: "application/pdf" }) as { ok: true; ext: string; mime: string } | { ok: false; reason: string });
  const removeObject = vi.fn(async (_k: string) => {});
  const markVerified = vi.fn(async (_file: string, _size: number) => ({ error: null as { code?: string } | null }));
  const deps: WorkDeps = {
    getUserId: async () => "u1", throttle: async () => true, rpc, revalidate,
    storage: { signUploadUrl, signDownloadUrl }, verify, removeObject, markVerified, newId: () => FILE, ...over,
  };
  return { svc: createWorkService(deps), rpc, revalidate, signUploadUrl, signDownloadUrl, verify, removeObject, markVerified };
}

describe("gates", () => {
  it("refuses anonymous callers before touching anything", async () => {
    const { svc, rpc } = setup({ getUserId: async () => null });
    expect(await svc.deleteTask({ orgId: ORG, id: TASK })).toEqual({ ok: false, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rate limits", async () => {
    const { svc, rpc } = setup({ throttle: async () => false });
    expect(await svc.deleteTask({ orgId: ORG, id: TASK })).toEqual({ ok: false, code: "rate" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a failing rate limiter is an error, not a pass", async () => {
    const { svc } = setup({ throttle: async () => { throw new Error("redis"); } });
    expect(await svc.deleteTask({ orgId: ORG, id: TASK })).toEqual({ ok: false, code: "error" });
  });
});

describe("tasks", () => {
  it("saves a task", async () => {
    const { svc, rpc, revalidate } = setup();
    rpc.mockResolvedValueOnce({ data: TASK, error: null });
    const r = await svc.saveTask({ orgId: ORG, contractId: CON, title: "  Draft  ", priority: "high", visibility: "shared", due: "2026-11-01" });
    expect(r).toEqual({ ok: true, id: TASK });
    expect(rpc).toHaveBeenCalledWith("task_save", {
      p_org: ORG, p_contract: CON, p_id: null, p_title: "Draft", p_description: "", p_priority: "high",
      p_assignee: null, p_due: "2026-11-01", p_milestone: null, p_visibility: "shared",
    });
    expect(revalidate).toHaveBeenCalledWith(`/contracts/${CON}/work`);
  });
  it("rejects an empty title and a bad date without calling the database", async () => {
    const { svc, rpc } = setup();
    expect(await svc.saveTask({ orgId: ORG, contractId: CON, title: " " })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.saveTask({ orgId: ORG, contractId: CON, title: "x", due: "tomorrow" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database codes", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["54000", "limit"], ["23505", "duplicate"], ["XX000", "error"]] as const) {
      const { svc, rpc } = setup();
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await svc.saveTask({ orgId: ORG, contractId: CON, title: "x" })).toEqual({ ok: false, code: want });
    }
  });
  it("sets status and deletes", async () => {
    const { svc, rpc } = setup();
    expect(await svc.setTaskStatus({ orgId: ORG, contractId: CON, id: TASK, status: "done" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("task_set_status", { p_org: ORG, p_id: TASK, p_status: "done" });
    expect(await svc.setTaskStatus({ orgId: ORG, contractId: CON, id: TASK, status: "finished" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.deleteTask({ orgId: ORG, contractId: CON, id: TASK })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("task_delete", { p_org: ORG, p_id: TASK });
  });
});

describe("task visibility", () => {
  it("changes only the visibility", async () => {
    const { svc, rpc, revalidate } = setup();
    expect(await svc.setTaskVisibility({ orgId: ORG, contractId: CON, id: TASK, visibility: "shared" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("task_set_visibility", { p_org: ORG, p_id: TASK, p_visibility: "shared" });
    expect(revalidate).toHaveBeenCalledWith(`/contracts/${CON}/work`);
    expect(await svc.setTaskVisibility({ orgId: ORG, id: TASK, visibility: "public" })).toEqual({ ok: false, code: "invalid" });
  });
});

describe("time", () => {
  it("logs time", async () => {
    const { svc, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: TASK, error: null });
    expect(await svc.logTime({ orgId: ORG, contractId: CON, date: "2026-10-01", minutes: 90, note: "calls" })).toEqual({ ok: true, id: TASK });
    expect(rpc).toHaveBeenCalledWith("time_log", { p_org: ORG, p_contract: CON, p_task: null, p_date: "2026-10-01", p_minutes: 90, p_note: "calls" });
  });
  it("rejects zero, fractional and over-a-day minutes", async () => {
    const { svc, rpc } = setup();
    for (const minutes of [0, 1.5, 1441, -3]) {
      expect(await svc.logTime({ orgId: ORG, contractId: CON, date: "2026-10-01", minutes })).toEqual({ ok: false, code: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("deletes an entry", async () => {
    const { svc, rpc } = setup();
    expect(await svc.deleteTime({ orgId: ORG, contractId: CON, id: TASK })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("time_delete", { p_org: ORG, p_id: TASK });
  });
});

describe("startUpload", () => {
  it("registers the file and returns a signed upload URL", async () => {
    const { svc, rpc, signUploadUrl } = setup();
    const r = await svc.startUpload(PDF);
    expect(r).toEqual({ ok: true, fileId: FILE, url: "https://r2/put" });
    const key = `orgs/${ORG}/${FILE}.pdf`;
    expect(rpc).toHaveBeenCalledWith("file_register", { p_org: ORG, p_contract: CON, p_id: FILE, p_name: "brief.pdf", p_mime: "application/pdf", p_size: 1000, p_key: key, p_visibility: "private" });
    expect(signUploadUrl).toHaveBeenCalledWith(key, "application/pdf", 1000);
  });
  it("rejects a bad type before registering anything", async () => {
    const { svc, rpc } = setup();
    expect(await svc.startUpload({ ...PDF, name: "run.exe", mime: "application/x-msdownload" })).toEqual({ ok: false, code: "file", reason: "file type not allowed" });
    expect(await svc.startUpload({ ...PDF, size: 11 * 1024 * 1024 })).toEqual({ ok: false, code: "file", reason: "file exceeds 10 MB" });
    expect(await svc.startUpload({ ...PDF, name: "a".repeat(252) + ".pdf" })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a limit error from registration and signs nothing", async () => {
    const { svc, rpc, signUploadUrl } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "54000" } });
    expect(await svc.startUpload(PDF)).toEqual({ ok: false, code: "limit" });
    expect(signUploadUrl).not.toHaveBeenCalled();
  });
  it("removes the pending row if signing fails", async () => {
    const { svc, rpc } = setup({ storage: { signUploadUrl: async () => { throw new Error("r2"); }, signDownloadUrl: async () => "x" } });
    expect(await svc.startUpload(PDF)).toEqual({ ok: false, code: "error" });
    expect(rpc).toHaveBeenLastCalledWith("file_delete", { p_org: ORG, p_id: FILE });
  });
});

describe("finishUpload", () => {
  const ref = { orgId: ORG, contractId: CON, fileId: FILE };
  const row = { object_key: `orgs/${ORG}/${FILE}.pdf`, name: "brief.pdf", mime: "application/pdf", size_bytes: 1000 };
  it("checks the stored bytes against the stored row, records the verification as the server, then confirms", async () => {
    const { svc, rpc, verify, markVerified } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    expect(await svc.finishUpload(ref)).toEqual({ ok: true });
    expect(rpc).toHaveBeenNthCalledWith(1, "file_pending_key", { p_org: ORG, p_id: FILE });
    expect(verify).toHaveBeenCalledWith(row.object_key, { name: "brief.pdf", declaredMime: "application/pdf", expectedSize: 1000 });
    expect(markVerified).toHaveBeenCalledWith(FILE, 1000);
    expect(rpc).toHaveBeenNthCalledWith(2, "file_confirm", { p_org: ORG, p_id: FILE });
  });
  it("ignores any name or type the browser sends", async () => {
    const { svc, rpc, verify } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    await svc.finishUpload({ ...ref, name: "evil.html", mime: "text/html" });
    expect(verify).toHaveBeenCalledWith(row.object_key, expect.objectContaining({ name: "brief.pdf", declaredMime: "application/pdf" }));
  });
  it("deletes the pending row when the bytes do not match, and never records a verification", async () => {
    const { svc, rpc, verify, markVerified } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    verify.mockResolvedValueOnce({ ok: false, reason: "content does not match file type" });
    expect(await svc.finishUpload(ref)).toEqual({ ok: false, code: "file", reason: "content does not match file type" });
    expect(markVerified).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("file_delete", { p_org: ORG, p_id: FILE });
  });
  it("does not confirm when the verification could not be recorded", async () => {
    const { svc, rpc, markVerified } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    markVerified.mockResolvedValueOnce({ error: { code: "22023" } });
    expect(await svc.finishUpload(ref)).toEqual({ ok: false, code: "invalid" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not verify anything when the file is not pending for this org", async () => {
    const { svc, rpc, verify } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect(await svc.finishUpload(ref)).toEqual({ ok: false, code: "invalid" });
    expect(verify).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("files", () => {
  it("deletes the database row first, then the stored object", async () => {
    const { svc, rpc, removeObject } = setup();
    rpc.mockResolvedValueOnce({ data: `orgs/${ORG}/${FILE}.pdf`, error: null });
    expect(await svc.deleteFile({ orgId: ORG, contractId: CON, id: FILE })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("file_delete", { p_org: ORG, p_id: FILE });
    expect(removeObject).toHaveBeenCalledWith(`orgs/${ORG}/${FILE}.pdf`);
  });
  it("still succeeds if object removal fails (the row is already gone)", async () => {
    const { svc, rpc } = setup({ removeObject: async () => { throw new Error("r2"); } });
    rpc.mockResolvedValueOnce({ data: `orgs/${ORG}/${FILE}.pdf`, error: null });
    expect(await svc.deleteFile({ orgId: ORG, contractId: CON, id: FILE })).toEqual({ ok: true });
  });
  it("does not remove anything when the database refuses", async () => {
    const { svc, rpc, removeObject } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await svc.deleteFile({ orgId: ORG, contractId: CON, id: FILE })).toEqual({ ok: false, code: "forbidden" });
    expect(removeObject).not.toHaveBeenCalled();
  });
  it("changes visibility", async () => {
    const { svc, rpc } = setup();
    expect(await svc.setFileVisibility({ orgId: ORG, contractId: CON, id: FILE, visibility: "shared" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("file_set_visibility", { p_org: ORG, p_id: FILE, p_visibility: "shared" });
    expect(await svc.setFileVisibility({ orgId: ORG, contractId: CON, id: FILE, visibility: "public" })).toEqual({ ok: false, code: "invalid" });
  });
});

describe("authorizeDownload", () => {
  it("signs a URL only after the database authorizes", async () => {
    const { svc, rpc, signDownloadUrl } = setup();
    rpc.mockResolvedValueOnce({ data: [{ object_key: `orgs/${ORG}/${FILE}.pdf`, name: "brief.pdf", mime: "application/pdf" }], error: null });
    expect(await svc.authorizeDownload({ id: FILE })).toEqual({ ok: true, url: "https://r2/get", name: "brief.pdf" });
    expect(rpc).toHaveBeenCalledWith("file_authorize", { p_file: FILE });
    expect(signDownloadUrl).toHaveBeenCalledWith(`orgs/${ORG}/${FILE}.pdf`);
  });
  it("signs nothing when refused", async () => {
    const { svc, rpc, signDownloadUrl } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await svc.authorizeDownload({ id: FILE })).toEqual({ ok: false, code: "forbidden" });
    expect(signDownloadUrl).not.toHaveBeenCalled();
  });
  it("treats an empty answer as an error, not access", async () => {
    const { svc, rpc, signDownloadUrl } = setup();
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await svc.authorizeDownload({ id: FILE })).ok).toBe(false);
    expect(signDownloadUrl).not.toHaveBeenCalled();
  });
});

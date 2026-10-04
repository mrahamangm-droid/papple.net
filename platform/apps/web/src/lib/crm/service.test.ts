import { describe, expect, it, vi } from "vitest";
import { createCrmService, type CrmDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const CON = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

function mk(rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>, over: Partial<CrmDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: ID, error: null })));
  const revalidate = vi.fn();
  const deps: CrmDeps = { getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, ...over };
  return { svc: createCrmService(deps), rpc, revalidate };
}

describe("saveContact", () => {
  it("normalises input and calls the RPC", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.saveContact({ orgId: ORG, name: "  Sara ", email: " Sara@X.test ", company: "", phone: "" })).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith("crm_save_contact", { p_org: ORG, p_id: null, p_name: "Sara", p_company: null, p_email: "Sara@X.test", p_phone: null, p_source: "manual" });
    expect(revalidate).toHaveBeenCalledWith("/crm");
  });
  it("only lets users pick manual or marketplace as the source", async () => {
    const { svc } = mk();
    expect(await svc.saveContact({ orgId: ORG, name: "A", source: "import" })).toEqual({ ok: false, code: "invalid" });
  });
  it("rejects bad input and signed-out callers before any call", async () => {
    const { svc, rpc } = mk();
    expect(await svc.saveContact({ orgId: "x", name: "A" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.saveContact({ orgId: ORG, name: "" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.saveContact({ orgId: ORG, name: "A", email: "nope" })).toEqual({ ok: false, code: "invalid" });
    expect(await mk(undefined, { getUserId: async () => null }).svc.saveContact({ orgId: ORG, name: "A" })).toEqual({ ok: false, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database codes and fails closed on a broken limiter", async () => {
    const run = async (code: string) => mk(async () => ({ data: null, error: { code } })).svc.saveContact({ orgId: ORG, name: "A" });
    expect(await run("42501")).toEqual({ ok: false, code: "forbidden" });
    expect(await run("54000")).toEqual({ ok: false, code: "limit" });
    expect(await run("23505")).toEqual({ ok: false, code: "duplicate" });
    expect(await run("22023")).toEqual({ ok: false, code: "invalid" });
    expect(await run("XX000")).toEqual({ ok: false, code: "error" });
    expect(await mk(undefined, { throttle: async () => false }).svc.saveContact({ orgId: ORG, name: "A" })).toEqual({ ok: false, code: "rate" });
    expect(await mk(undefined, { throttle: async () => { throw new Error("down"); } }).svc.saveContact({ orgId: ORG, name: "A" })).toEqual({ ok: false, code: "error" });
  });
});

describe("importCsv", () => {
  const csv = "name,email\nSara,sara@x.test\n,bad@x.test\nLee,lee@x.test\n";
  it("sends parsed rows and maps invalid row indexes back to file lines", async () => {
    const { svc, rpc } = mk(async () => ({ data: { imported: 2, duplicate: 0, invalid: [2], limit: 0 }, error: null }));
    expect(await svc.importCsv({ orgId: ORG, csv, attested: true })).toEqual({ ok: true, report: { imported: 2, duplicate: 0, invalidLines: [3], limit: 0 } });
    expect(rpc).toHaveBeenCalledWith("crm_import_contacts", {
      p_org: ORG, p_attested: true,
      p_rows: [{ name: "Sara", email: "sara@x.test", company: "", phone: "" }, { name: "", email: "bad@x.test", company: "", phone: "" }, { name: "Lee", email: "lee@x.test", company: "", phone: "" }],
    });
  });
  it("needs the attestation and a valid file before calling the database", async () => {
    const { svc, rpc } = mk();
    expect(await svc.importCsv({ orgId: ORG, csv, attested: false })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.importCsv({ orgId: ORG, csv: "email\na@x.test", attested: true })).toEqual({ ok: false, code: "csv_no_name_column" });
    expect(await svc.importCsv({ orgId: ORG, csv: "", attested: true })).toEqual({ ok: false, code: "csv_empty" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("deals and notes", () => {
  it("saves a deal with value in minor units", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.saveDeal({ orgId: ORG, contactId: CON, title: "Survey", stage: "lead", value: 500000, currency: "aed", expectedClose: "2026-12-01" })).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith("crm_save_deal", { p_org: ORG, p_id: null, p_contact: CON, p_title: "Survey", p_stage: "lead", p_value: 500000, p_currency: "AED", p_close: "2026-12-01" });
    expect(revalidate).toHaveBeenCalledWith(`/crm/${CON}`);
  });
  it("requires a currency with a value and a known stage", async () => {
    const { svc } = mk();
    expect(await svc.saveDeal({ orgId: ORG, contactId: CON, title: "T", stage: "lead", value: 10 })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.saveDeal({ orgId: ORG, contactId: CON, title: "T", stage: "maybe" })).toEqual({ ok: false, code: "invalid" });
  });
  it("adds and completes notes", async () => {
    const { svc, rpc } = mk();
    expect(await svc.addNote({ orgId: ORG, contactId: CON, body: " Call ", followUpAt: "2026-10-20T09:00:00Z" })).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith("crm_add_note", { p_org: ORG, p_contact: CON, p_body: "Call", p_follow_up: "2026-10-20T09:00:00.000Z" });
    expect(await svc.completeNote({ orgId: ORG, contactId: CON, noteId: ID })).toEqual({ ok: true });
    expect(await svc.deleteContact({ orgId: ORG, id: CON })).toEqual({ ok: true });
  });
});

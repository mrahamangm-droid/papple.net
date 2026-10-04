import { describe, expect, it, vi } from "vitest";
import { createCredentialService, type CredentialDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";

function mk(rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>, over: Partial<CredentialDeps> = {}) {
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: CRED, error: null })));
  const revalidate = vi.fn();
  const deps: CredentialDeps = { getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, revalidate, ...over };
  return { svc: createCredentialService(deps), rpc, revalidate };
}
const good = { orgId: ORG, kind: "licence", title: "  PE Licence ", issuer: "Engineers Board", identifier: "PE-1", issuedOn: "2020-01-01", expiresOn: "2030-01-01", evidenceUrl: "https://example.com/x" };

describe("save", () => {
  it("normalises input and calls the database", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.save(good)).toEqual({ ok: true, id: CRED });
    expect(rpc).toHaveBeenCalledWith("credential_save", { p_org: ORG, p_id: null, p_kind: "licence", p_title: "PE Licence", p_issuer: "Engineers Board", p_identifier: "PE-1", p_issued: "2020-01-01", p_expires: "2030-01-01", p_evidence_url: "https://example.com/x" });
    expect(revalidate).toHaveBeenCalledWith("/settings/credentials");
  });
  it("sends blanks as null and passes the id when editing", async () => {
    const { svc, rpc } = mk();
    await svc.save({ orgId: ORG, id: CRED, kind: "award", title: "Best Paper", issuer: "Society", identifier: "", issuedOn: "", expiresOn: "", evidenceUrl: "" });
    expect(rpc).toHaveBeenCalledWith("credential_save", { p_org: ORG, p_id: CRED, p_kind: "award", p_title: "Best Paper", p_issuer: "Society", p_identifier: null, p_issued: null, p_expires: null, p_evidence_url: null });
  });
  it("rejects bad input before any call", async () => {
    const { svc, rpc } = mk();
    for (const bad of [{ ...good, kind: "wizard" }, { ...good, title: "No" }, { ...good, issuer: "I" }, { ...good, evidenceUrl: "http://x.test" }, { ...good, issuedOn: "01/01/2020" }, { ...good, orgId: "x" }, { ...good, expiresOn: "2019-01-01" }])
      expect(await svc.save(bad)).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("needs a signed-in user and fails closed on a tripped or broken limiter", async () => {
    expect(await mk(undefined, { getUserId: async () => null }).svc.save(good)).toEqual({ ok: false, code: "forbidden" });
    expect(await mk(undefined, { throttle: async () => false }).svc.save(good)).toEqual({ ok: false, code: "rate" });
    expect(await mk(undefined, { throttle: async () => { throw new Error("x"); } }).svc.save(good)).toEqual({ ok: false, code: "error" });
  });
  it("maps database codes", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["22023", "invalid"], ["54000", "limit"], ["XX000", "error"]] as const)
      expect(await mk(async () => ({ data: null, error: { code } })).svc.save(good)).toEqual({ ok: false, code: want });
  });
});

describe("delete and request a check", () => {
  it("calls the database and refreshes the page", async () => {
    const { svc, rpc, revalidate } = mk(async () => ({ data: null, error: null }));
    expect(await svc.remove({ orgId: ORG, id: CRED })).toEqual({ ok: true });
    expect(await svc.requestCheck({ orgId: ORG, id: CRED, note: "Please check my licence" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("credential_delete", { p_org: ORG, p_id: CRED });
    expect(rpc).toHaveBeenCalledWith("credential_request_check", { p_org: ORG, p_id: CRED, p_note: "Please check my licence" });
    expect(revalidate).toHaveBeenCalledWith("/settings/credentials");
  });
  it("needs a real note and valid ids", async () => {
    const { svc, rpc } = mk();
    expect(await svc.requestCheck({ orgId: ORG, id: CRED, note: "short" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.remove({ orgId: "x", id: CRED })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

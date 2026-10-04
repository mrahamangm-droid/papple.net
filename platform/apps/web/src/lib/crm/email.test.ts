import { describe, expect, it, vi } from "vitest";
import { buildEmailText, createCrmEmailService, EmailRefused, type CrmEmailDeps, type OutgoingEmail } from "./email";

const ORG = "11111111-1111-4111-8111-111111111111";
const CON = "22222222-2222-4222-8222-222222222222";
const MID = "33333333-3333-4333-8333-333333333333";
const reserved = { id: MID, to: "sara@x.test", subject: "Hello", body: "Hi Sara", basis: "existing_client", legal_name: "Org A FZE LLC", address: "Office 1, Dubai", country: "AE" };

function mk(over: Partial<CrmEmailDeps> = {}, rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>) {
  const rpc = vi.fn(rpcImpl ?? (async (fn: string) => (fn === "crm_reserve_email" ? { data: reserved, error: null } : { data: null, error: null })));
  const send = vi.fn(async (_m: OutgoingEmail): Promise<string | null> => "prov_1");
  const mark = vi.fn(async (_id: string, _status: "sent" | "failed" | "unknown", _provider: string | null) => {});
  const revalidate = vi.fn();
  const deps: CrmEmailDeps = {
    getUserId: async () => "u1", throttle: async () => true, rpc: rpc as never, send, mark, revalidate,
    isConfigured: () => true, unsubscribeUrl: (org, email) => `https://papple.test/crm-unsubscribe?t=${org}.${email}`, replyTo: async () => "me@pro.test", ...over,
  };
  return { svc: createCrmEmailService(deps), rpc, send, mark, revalidate };
}
const input = { orgId: ORG, contactId: CON, subject: " Hello ", body: " Hi Sara " };

describe("buildEmailText", () => {
  it("appends the sender identity, the reason and the unsubscribe link, in that order", () => {
    const t = buildEmailText({ body: "Hi", legalName: "Org A FZE LLC", address: "Office 1, Dubai", country: "AE", basis: "opted_in", unsubscribeUrl: "https://u.test/x" });
    expect(t.startsWith("Hi\n\n--\n")).toBe(true);
    expect(t).toContain("Sent by Org A FZE LLC, Office 1, Dubai, AE.");
    expect(t).toContain("you asked to receive email from Org A FZE LLC");
    expect(t.trimEnd().endsWith("Unsubscribe: https://u.test/x")).toBe(true);
  });
  it("words each basis differently", () => {
    const f = (basis: string) => buildEmailText({ body: "x", legalName: "N", address: "A", country: "AE", basis, unsubscribeUrl: "u" });
    expect(f("existing_client")).toContain("you are a client of N");
    expect(f("requested_contact")).toContain("you asked N to contact you");
  });
});

describe("sendEmail", () => {
  it("reserves, sends the footer-wrapped text with reply-to and one-click headers, then marks it sent", async () => {
    const { svc, rpc, send, mark, revalidate } = mk();
    expect(await svc.sendEmail(input)).toEqual({ ok: true });
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_reserve_email", { p_org: ORG, p_contact: CON, p_subject: "Hello", p_body: "Hi Sara" });
    const msg = send.mock.calls[0]![0];
    expect(msg).toMatchObject({ to: "sara@x.test", subject: "Hello", replyTo: "me@pro.test", fromName: "Org A FZE LLC" });
    expect(msg.text).toContain("Hi Sara");
    expect(msg.text).toContain(msg.unsubscribeUrl);
    expect(msg.idempotencyKey).toBe(MID);
    expect(mark).toHaveBeenCalledWith(MID, "sent", "prov_1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith(`/crm/${CON}`);
  });
  it("sends nothing and reserves nothing when email is not configured", async () => {
    const { svc, rpc, send } = mk({ isConfigured: () => false });
    expect(await svc.sendEmail(input)).toEqual({ ok: false, code: "notready" });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("validates before touching the network or database", async () => {
    const { svc, rpc } = mk();
    for (const bad of [{ ...input, subject: "A\nBcc: x@y.z" }, { ...input, subject: "" }, { ...input, body: " " }, { ...input, orgId: "x" }, { ...input, body: "x".repeat(5001) }]) {
      expect(await svc.sendEmail(bad)).toEqual({ ok: false, code: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database refusals and never sends after one", async () => {
    for (const [code, want] of [["42501", "forbidden"], ["55000", "notready"], ["23P01", "suppressed"], ["54000", "limit"], ["22023", "invalid"], ["XX000", "error"]] as const) {
      const { svc, send } = mk({}, async () => ({ data: null, error: { code } }));
      expect(await svc.sendEmail(input)).toEqual({ ok: false, code: want });
      expect(send).not.toHaveBeenCalled();
    }
  });
  it("marks the message failed only when the provider definitely refused it", async () => {
    const { svc, mark } = mk({ send: async () => { throw new EmailRefused(); } });
    expect(await svc.sendEmail(input)).toEqual({ ok: false, code: "send_failed" });
    expect(mark).toHaveBeenCalledWith(MID, "failed", null);
  });
  it("marks an ambiguous outcome unknown, because the message may have been delivered", async () => {
    const { svc, mark } = mk({ send: async () => { throw new Error("socket hang up"); } });
    expect(await svc.sendEmail(input)).toEqual({ ok: false, code: "unconfirmed" });
    expect(mark).toHaveBeenCalledWith(MID, "unknown", null);
  });
  it("records a message the provider accepted without an id as sent", async () => {
    const { svc, mark } = mk({ send: async () => null });
    expect(await svc.sendEmail(input)).toEqual({ ok: true });
    expect(mark).toHaveBeenCalledWith(MID, "sent", null);
  });
  it("still reports success when the message was sent but recording it failed", async () => {
    const { svc } = mk({ mark: async () => { throw new Error("db"); } });
    expect(await svc.sendEmail(input)).toEqual({ ok: true });
  });
  it("sends the subject and body exactly as the database stored them", async () => {
    const { svc, send } = mk({}, async (fn) => (fn === "crm_reserve_email" ? { data: { ...reserved, subject: "Stored subject", body: "Stored body" }, error: null } : { data: null, error: null }));
    await svc.sendEmail(input);
    expect(send.mock.calls[0]![0]).toMatchObject({ subject: "Stored subject" });
    expect(send.mock.calls[0]![0].text).toContain("Stored body");
  });
  it("is throttled, signed-in only, and fails closed on a broken limiter", async () => {
    expect(await mk({ throttle: async () => false }).svc.sendEmail(input)).toEqual({ ok: false, code: "rate" });
    expect(await mk({ throttle: async () => { throw new Error("x"); } }).svc.sendEmail(input)).toEqual({ ok: false, code: "error" });
    expect(await mk({ getUserId: async () => null }).svc.sendEmail(input)).toEqual({ ok: false, code: "forbidden" });
  });
  it("refuses to send when the database returned an unexpected shape", async () => {
    const { svc, send } = mk({}, async () => ({ data: { id: MID }, error: null }));
    expect(await svc.sendEmail(input)).toEqual({ ok: false, code: "error" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("setBasis", () => {
  it("records or clears the basis", async () => {
    const { svc, rpc, revalidate } = mk();
    expect(await svc.setBasis({ orgId: ORG, contactId: CON, basis: "opted_in" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("crm_set_basis", { p_org: ORG, p_contact: CON, p_basis: "opted_in" });
    expect(await svc.setBasis({ orgId: ORG, contactId: CON, basis: "" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("crm_set_basis", { p_org: ORG, p_contact: CON, p_basis: null });
    expect(revalidate).toHaveBeenCalledWith(`/crm/${CON}`);
  });
  it("rejects an unknown basis", async () => {
    expect(await mk().svc.setBasis({ orgId: ORG, contactId: CON, basis: "because" })).toEqual({ ok: false, code: "invalid" });
  });
});

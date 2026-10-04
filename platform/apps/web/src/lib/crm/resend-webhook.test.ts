import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createResendWebhook, verifySvixSignature } from "./resend-webhook";

const KEY = Buffer.from("super-secret-signing-key-material").toString("base64");
const SECRET = `whsec_${KEY}`;
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const ts = String(Math.floor(NOW / 1000));
const sign = (id: string, t: string, body: string, key = KEY) => `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${t}.${body}`).digest("base64")}`;

describe("verifySvixSignature", () => {
  const body = '{"type":"email.bounced"}';
  const ok = (over: Partial<Parameters<typeof verifySvixSignature>[0]> = {}) =>
    verifySvixSignature({ secret: SECRET, id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body), body, now: () => NOW, ...over });
  it("accepts a correct signature", () => expect(ok()).toBe(true));
  it("accepts when any listed signature matches", () => expect(ok({ signature: `v1,AAAA ${sign("msg_1", ts, body)}` })).toBe(true));
  it("rejects a changed body, id, or secret", () => {
    expect(ok({ body: body + " " })).toBe(false);
    expect(ok({ id: "msg_2" })).toBe(false);
    expect(ok({ secret: `whsec_${Buffer.from("different").toString("base64")}` })).toBe(false);
  });
  it("rejects old and future timestamps", () => {
    const old = String(Math.floor(NOW / 1000) - 600);
    expect(ok({ timestamp: old, signature: sign("msg_1", old, body) })).toBe(false);
    const future = String(Math.floor(NOW / 1000) + 600);
    expect(ok({ timestamp: future, signature: sign("msg_1", future, body) })).toBe(false);
  });
  it("rejects missing headers and a missing secret", () => {
    expect(ok({ signature: "" })).toBe(false);
    expect(ok({ id: "" })).toBe(false);
    expect(ok({ secret: "" })).toBe(false);
    expect(ok({ secret: "not-whsec" })).toBe(false);
    expect(ok({ timestamp: "abc" })).toBe(false);
  });
});

describe("resend webhook handler", () => {
  const event = (type: string, emailId = "prov_1") => JSON.stringify({ type, data: { email_id: emailId } });
  const run = async (rawBody: string, over: { secret?: string | undefined; signed?: boolean } = {}) => {
    const suppress = vi.fn(async () => true);
    const handler = createResendWebhook({ secret: "secret" in over ? over.secret : SECRET, suppress, now: () => NOW });
    const sig = over.signed === false ? "v1,bad" : sign("m1", ts, rawBody);
    const r = await handler.handle(rawBody, { id: "m1", timestamp: ts, signature: sig });
    return { r, suppress };
  };
  it("suppresses a bounced address and a complained one", async () => {
    const a = await run(event("email.bounced"));
    expect(a.r).toEqual({ status: 200 });
    expect(a.suppress).toHaveBeenCalledWith("prov_1", "bounce");
    const b = await run(event("email.complained"));
    expect(b.suppress).toHaveBeenCalledWith("prov_1", "complaint");
  });
  it("does not suppress on a temporary bounce", async () => {
    const x = await run(JSON.stringify({ type: "email.bounced", data: { email_id: "prov_1", bounce: { type: "Transient" } } }));
    expect(x.r).toEqual({ status: 200 });
    expect(x.suppress).not.toHaveBeenCalled();
    const y = await run(JSON.stringify({ type: "email.bounced", data: { email_id: "prov_1", bounce: { type: "Permanent" } } }));
    expect(y.suppress).toHaveBeenCalledWith("prov_1", "bounce");
  });
  it("ignores other event types", async () => {
    const x = await run(event("email.delivered"));
    expect(x.r).toEqual({ status: 200 });
    expect(x.suppress).not.toHaveBeenCalled();
  });
  it("answers 401 to a bad signature and 503 when no secret is configured, without acting", async () => {
    const bad = await run(event("email.bounced"), { signed: false });
    expect(bad.r).toEqual({ status: 401 });
    expect(bad.suppress).not.toHaveBeenCalled();
    const none = await run(event("email.bounced"), { secret: undefined });
    expect(none.r).toEqual({ status: 503 });
    expect(none.suppress).not.toHaveBeenCalled();
  });
  it("answers 400 to a signed but malformed body and 500 when storing fails (so the provider retries)", async () => {
    expect((await run("not json")).r).toEqual({ status: 400 });
    expect((await run(JSON.stringify({ type: "email.bounced", data: {} }))).r).toEqual({ status: 400 });
    const handler = createResendWebhook({ secret: SECRET, suppress: async () => { throw new Error("db"); }, now: () => NOW });
    const body = event("email.bounced");
    expect(await handler.handle(body, { id: "m1", timestamp: ts, signature: sign("m1", ts, body) })).toEqual({ status: 500 });
  });
});

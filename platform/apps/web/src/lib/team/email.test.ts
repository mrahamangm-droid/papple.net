import { describe, expect, it, vi } from "vitest";
import { buildInviteEmail, createInviteMailer } from "./email";

const base = { orgName: "Acme FZE", inviterName: "Sara", role: "member", link: "https://papple.net/invite/abc" };

describe("buildInviteEmail", () => {
  it("names the organization, the inviter and the role, carries the link and says it can be ignored", () => {
    const m = buildInviteEmail(base);
    expect(m.subject).toBe("Sara invited you to join Acme FZE on PAPple");
    expect(m.text).toContain("https://papple.net/invite/abc");
    expect(m.text).toMatch(/Member/);
    expect(m.text).toMatch(/ignore this email/i);
    expect(m.text).toMatch(/7 days/);
  });
  it("cannot be used to inject headers or fake text through names", () => {
    const m = buildInviteEmail({ ...base, orgName: "Acme\r\nBcc: x@y.test", inviterName: "Eve\nSubject: hi" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text.split("\n").some((l) => /^(bcc|subject|to|cc):/i.test(l))).toBe(false);
  });
  it("has no tracking and no unsubscribe machinery (a one-off transactional message)", () => {
    expect(buildInviteEmail(base).text).not.toMatch(/unsubscribe|pixel|utm_/i);
  });
});

describe("createInviteMailer", () => {
  const cfg = { apiKey: "k", from: "PAPple <no-reply@papple.net>" };
  it("posts to the provider with a bearer key, a stable idempotency key and a timeout, and returns the id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    const send = createInviteMailer({ ...cfg, fetchImpl: fetchImpl as never });
    expect(await send({ to: "a@b.test", subject: "S", text: "T", idempotencyKey: "inv-1" })).toBe("m1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("inv-1");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(String(init.body))).toMatchObject({ from: cfg.from, to: "a@b.test", subject: "S", text: "T" });
  });
  it("throws on a refusal so the caller can report that the email did not go (the link still exists)", async () => {
    const send = createInviteMailer({ ...cfg, fetchImpl: (async () => new Response("no", { status: 422 })) as never });
    await expect(send({ to: "a@b.test", subject: "S", text: "T", idempotencyKey: "i" })).rejects.toThrow();
  });
});

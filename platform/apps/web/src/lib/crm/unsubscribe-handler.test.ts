import { describe, expect, it, vi } from "vitest";
import { createUnsubscribeHandler } from "./unsubscribe-handler";
import { signUnsubscribeToken } from "./unsubscribe";

const ORG = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-secret-with-enough-length-0123456789";
const token = signUnsubscribeToken(SECRET, ORG, "Sara@Khan.test");

function mk(over: { secret?: string | undefined; allowed?: boolean; suppress?: () => Promise<void> } = {}) {
  const suppress = vi.fn(over.suppress ?? (async () => {}));
  const h = createUnsubscribeHandler({ secret: "secret" in over ? over.secret : SECRET, suppress, throttle: async () => over.allowed ?? true });
  return { h, suppress };
}

describe("unsubscribe handler", () => {
  it("GET only asks for confirmation and changes nothing (link scanners must not unsubscribe anyone)", async () => {
    const { h, suppress } = mk();
    const r = await h.get(token);
    expect(r.status).toBe(200);
    expect(r.html).toContain("<form");
    expect(r.html).toContain("post");
    expect(suppress).not.toHaveBeenCalled();
  });
  it("POST stores the suppression for the address and organization in the token", async () => {
    const { h, suppress } = mk();
    const r = await h.post(token);
    expect(r.status).toBe(200);
    expect(suppress).toHaveBeenCalledWith(ORG, "sara@khan.test");
    expect(r.html).toMatch(/unsubscribed/i);
  });
  it("rejects a forged or empty token on both methods without storing anything", async () => {
    const { h, suppress } = mk();
    for (const t of ["", "x.y", token.slice(0, -3) + "AAA", null as unknown as string]) {
      expect((await h.get(t)).status).toBe(400);
      expect((await h.post(t)).status).toBe(400);
    }
    expect(suppress).not.toHaveBeenCalled();
  });
  it("answers 503 when no secret is configured", async () => {
    expect((await mk({ secret: undefined }).h.post(token)).status).toBe(503);
  });
  it("never throttles a valid token (mailbox providers share IP addresses), only invalid attempts", async () => {
    const { h, suppress } = mk({ allowed: false });
    expect((await h.post(token)).status).toBe(200);
    expect(suppress).toHaveBeenCalledOnce();
    expect((await h.post("forged.token")).status).toBe(429);
    expect((await h.get("forged.token")).status).toBe(429);
    expect((await mk({ allowed: true }).h.post("forged.token")).status).toBe(400);
  });
  it("answers 500 without leaking details when storing fails", async () => {
    const r = await mk({ suppress: async () => { throw new Error("secret db detail"); } }).h.post(token);
    expect(r.status).toBe(500);
    expect(r.html).not.toContain("secret db detail");
  });
  it("never echoes the token or the address into the page", async () => {
    const r = await mk().h.get(token);
    expect(r.html).not.toContain("khan");
    expect(r.html).not.toContain(token);
  });
});

import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const ORG = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-secret-with-enough-length-0123456789";

describe("unsubscribe tokens", () => {
  it("round-trips and lower-cases the address", () => {
    const t = signUnsubscribeToken(SECRET, ORG, "Sara@Khan.test");
    expect(verifyUnsubscribeToken(SECRET, t)).toEqual({ orgId: ORG, email: "sara@khan.test" });
  });
  it("is url-safe", () => {
    expect(signUnsubscribeToken(SECRET, ORG, "a+b@x.test")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
  it("rejects a token signed with another secret or tampered with", () => {
    const t = signUnsubscribeToken(SECRET, ORG, "a@x.test");
    expect(verifyUnsubscribeToken("another-secret-with-enough-length-99", t)).toBeNull();
    const [p, s] = t.split(".");
    const other = Buffer.from(`${ORG}:b@x.test`).toString("base64url");
    expect(verifyUnsubscribeToken(SECRET, `${other}.${s}`)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${p}.${s!.slice(0, -2)}AA`)).toBeNull();
  });
  it("rejects malformed input without throwing", () => {
    for (const bad of ["", ".", "abc", "a.b.c", "😀.😀", "x".repeat(5000)]) expect(verifyUnsubscribeToken(SECRET, bad)).toBeNull();
  });
  it("refuses to sign or verify with a missing or short secret", () => {
    expect(() => signUnsubscribeToken("", ORG, "a@x.test")).toThrow();
    expect(() => signUnsubscribeToken("short", ORG, "a@x.test")).toThrow();
    expect(verifyUnsubscribeToken("", signUnsubscribeToken(SECRET, ORG, "a@x.test"))).toBeNull();
  });
  it("does not accept a token for a non-uuid organization or an invalid address", () => {
    expect(() => signUnsubscribeToken(SECRET, "nope", "a@x.test")).toThrow();
    expect(() => signUnsubscribeToken(SECRET, ORG, "not-an-email")).toThrow();
  });
});

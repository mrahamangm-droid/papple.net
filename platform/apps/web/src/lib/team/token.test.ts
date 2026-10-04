import { describe, expect, it } from "vitest";
import { hashInviteToken, isInviteToken, newInviteToken } from "./token";

describe("invite tokens", () => {
  it("are 256 random bits in a URL-safe form, never repeated", () => {
    const a = newInviteToken(), b = newInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
  });
  it("store only a SHA-256 hex digest, which matches hashing the token again", () => {
    const { token, hash } = newInviteToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });
  it("hashes a known value the way the database expects (hex sha256)", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("recognise only well-formed tokens", () => {
    expect(isInviteToken(newInviteToken().token)).toBe(true);
    for (const t of ["", "short", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "!", "a".repeat(42) + "/"]) expect(isInviteToken(t)).toBe(false);
  });
});

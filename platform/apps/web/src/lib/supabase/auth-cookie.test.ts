import { describe, expect, it } from "vitest";
import { hasAuthCookie } from "./auth-cookie";

describe("hasAuthCookie", () => {
  it("detects Supabase auth cookies, including chunked ones", () => {
    expect(hasAuthCookie(["sb-abc-auth-token"])).toBe(true);
    expect(hasAuthCookie(["x", "sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
  });
  it("is false for anonymous visitors and unrelated cookies", () => {
    expect(hasAuthCookie([])).toBe(false);
    expect(hasAuthCookie(["theme", "papple_consent_v1"])).toBe(false);
  });
});

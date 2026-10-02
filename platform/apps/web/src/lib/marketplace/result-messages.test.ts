import { describe, expect, it } from "vitest";
import { messageFor } from "./result-messages";

describe("messageFor", () => {
  it("returns calm, specific copy for each failure code", () => {
    for (const c of ["forbidden", "invalid", "limit", "duplicate", "rate", "error"] as const) {
      const m = messageFor({ ok: false, code: c });
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/postgres|supabase|exception|stack/i);
    }
  });
  it("returns an empty string on success", () => {
    expect(messageFor({ ok: true })).toBe("");
  });
});

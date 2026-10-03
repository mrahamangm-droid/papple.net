import { describe, expect, it } from "vitest";
import { aiMessageFor } from "./messages";

describe("aiMessageFor", () => {
  it.each(["forbidden", "invalid", "limit", "rate", "unavailable", "error"] as const)("has calm copy for %s", (c) => {
    const m = aiMessageFor({ ok: false, code: c });
    expect(m.length).toBeGreaterThan(20);
    expect(m).not.toMatch(/anthropic|claude|api key|exception|stack/i);
  });
  it("is empty on success", () => expect(aiMessageFor({ ok: true, text: "x" })).toBe(""));
  it("tells the person the allowance is used up and what to do", () => expect(aiMessageFor({ ok: false, code: "limit" })).toMatch(/allowance|limit/i));
});

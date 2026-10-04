import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const c = { ts: "2026-10-02T10:00:00.123456+00:00", id: "11111111-1111-4111-8111-111111111111" };

describe("cursor", () => {
  it("round-trips, keeping microseconds exactly", () => {
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("is url safe", () => expect(encodeCursor(c)).toMatch(/^[A-Za-z0-9_-]+$/));
  it("rejects garbage, wrong shapes and oversized input", () => {
    const enc = (s: string) => Buffer.from(s).toString("base64url");
    for (const bad of ["", "!!!", "abc", enc("nope"), enc(`2026-10-02|${c.id}`), enc(`${c.ts}|not-a-uuid`), enc(`${c.ts}|${c.id}|x`), enc(`'; drop table x;--|${c.id}`), enc(`2026-13-45T99:99:99Z|${c.id}`), enc(`2026-02-30T10:00:00Z|${c.id}`), "A".repeat(500)]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
  it("accepts a Z timestamp without fractional seconds", () => {
    const z = { ts: "2026-10-02T10:00:00Z", id: c.id };
    expect(decodeCursor(encodeCursor(z))).toEqual(z);
  });
});

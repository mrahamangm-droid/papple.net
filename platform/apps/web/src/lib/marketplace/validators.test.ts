import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, messageInput, proposalInput, reportInput, searchParams } from "./validators";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("cursor", () => {
  it("round-trips a valid pair", () => {
    expect(decodeCursor(encodeCursor(1.75, U1))).toEqual({ rank: 1.75, id: U1 });
  });
  it.each([
    undefined,
    "",
    "x",
    Buffer.from("1|not-a-uuid").toString("base64url"),
    Buffer.from(`NaN|${U1}`).toString("base64url"),
    Buffer.from(`Infinity|${U1}`).toString("base64url"),
    Buffer.from(`1|${U1}|extra`).toString("base64url"),
    "%%%not-base64%%%",
  ])("returns null for malformed cursor %j", (c) => {
    expect(decodeCursor(c as string | undefined)).toBeNull();
  });
});

describe("searchParams", () => {
  it("trims and caps q at 200 characters", () => {
    expect(searchParams.parse({ kind: "providers", q: `  ${"a".repeat(300)}  ` }).q).toHaveLength(200);
  });
  it("coerces comma-separated skills to at most 10 uuids", () => {
    const many = Array.from({ length: 14 }, (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(searchParams.parse({ kind: "providers", skills: many.join(",") }).skills).toHaveLength(10);
  });
  it("rejects a non-uuid skill", () => {
    expect(searchParams.safeParse({ kind: "providers", skills: "abc" }).success).toBe(false);
  });
  it.each(["-1", "abc", "1.5", "99999999999"])("rejects rate_max %j", (v) => {
    expect(searchParams.safeParse({ kind: "providers", rate_max: v }).success).toBe(false);
  });
  it("rejects an unknown kind and accepts the two real ones", () => {
    expect(searchParams.safeParse({ kind: "x" }).success).toBe(false);
    expect(searchParams.safeParse({ kind: "services" }).success).toBe(true);
  });
  it("upper-cases a two-letter country and rejects others", () => {
    expect(searchParams.parse({ kind: "providers", country: "ae" }).country).toBe("AE");
    expect(searchParams.safeParse({ kind: "providers", country: "UAE" }).success).toBe(false);
  });
});

describe("proposalInput", () => {
  const ok = { orgId: U1, projectId: U2, coverLetter: "Hello", price: 1000, currency: "USD", deliveryDays: 7 };
  it("accepts a valid proposal", () => expect(proposalInput.safeParse(ok).success).toBe(true));
  it.each([0, -1, 2147483648, 1.5])("rejects price %s", (price) => {
    expect(proposalInput.safeParse({ ...ok, price }).success).toBe(false);
  });
  it("rejects an empty or whitespace cover letter", () => {
    expect(proposalInput.safeParse({ ...ok, coverLetter: "   " }).success).toBe(false);
  });
  it("rejects a cover letter over 5000 characters", () => {
    expect(proposalInput.safeParse({ ...ok, coverLetter: "a".repeat(5001) }).success).toBe(false);
  });
});

describe("messageInput", () => {
  const ok = { conversationId: U1, orgId: U2, body: "hi" };
  it("rejects whitespace-only and over-long bodies, accepts exactly 4000", () => {
    expect(messageInput.safeParse({ ...ok, body: "   " }).success).toBe(false);
    expect(messageInput.safeParse({ ...ok, body: "a".repeat(4001) }).success).toBe(false);
    expect(messageInput.safeParse({ ...ok, body: "a".repeat(4000) }).success).toBe(true);
  });
});

describe("reportInput", () => {
  it("requires a known kind and a reason up to 1000 characters", () => {
    expect(reportInput.safeParse({ kind: "profile", id: U1, reason: "spam" }).success).toBe(true);
    expect(reportInput.safeParse({ kind: "banana", id: U1, reason: "spam" }).success).toBe(false);
    expect(reportInput.safeParse({ kind: "profile", id: U1, reason: "a".repeat(1001) }).success).toBe(false);
  });
});

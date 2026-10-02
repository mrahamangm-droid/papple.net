import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMemoryWebhookStore, processOnce, verifyHmacSignature } from "./webhooks";

const secret = "whsec_test";
const sign = (ts: number, payload: string) => createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");

describe("verifyHmacSignature", () => {
  const payload = '{"id":"evt_1"}';
  const ts = 1_700_000_000;
  const now = () => ts * 1000;
  it("accepts a valid signature inside the tolerance", () => {
    expect(verifyHmacSignature({ payload, signature: sign(ts, payload), secret, timestamp: ts, now })).toBe(true);
  });
  it("rejects a tampered payload", () => {
    expect(verifyHmacSignature({ payload: '{"id":"evt_2"}', signature: sign(ts, payload), secret, timestamp: ts, now })).toBe(false);
  });
  it("rejects a wrong secret and a malformed or wrong-length signature without throwing", () => {
    expect(verifyHmacSignature({ payload, signature: sign(ts, payload), secret: "other", timestamp: ts, now })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: "abc", secret, timestamp: ts, now })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: "zz".repeat(32), secret, timestamp: ts, now })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: "", secret, timestamp: ts, now })).toBe(false);
  });
  it("rejects a stale timestamp beyond the tolerance (replay) and a future one", () => {
    expect(verifyHmacSignature({ payload, signature: sign(ts, payload), secret, timestamp: ts, toleranceSec: 300, now: () => (ts + 301) * 1000 })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: sign(ts, payload), secret, timestamp: ts, toleranceSec: 300, now: () => (ts - 301) * 1000 })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: sign(ts, payload), secret, timestamp: ts, toleranceSec: 300, now: () => (ts + 299) * 1000 })).toBe(true);
  });
});

describe("processOnce", () => {
  it("runs the handler once and reports duplicates", async () => {
    const store = createMemoryWebhookStore();
    const handler = vi.fn(async () => {});
    expect(await processOnce(store, "stripe", "evt_1", handler)).toBe("processed");
    expect(await processOnce(store, "stripe", "evt_1", handler)).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("treats the same id from different providers as distinct", async () => {
    const store = createMemoryWebhookStore();
    const handler = vi.fn(async () => {});
    await processOnce(store, "stripe", "evt_1", handler);
    await processOnce(store, "resend", "evt_1", handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("runs the handler once under concurrent delivery of the same event", async () => {
    const store = createMemoryWebhookStore();
    const handler = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const results = await Promise.all([1, 2, 3].map(() => processOnce(store, "stripe", "evt_9", handler)));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r === "processed")).toHaveLength(1);
  });
  it("releases the claim when the handler throws so the provider's retry is processed", async () => {
    const store = createMemoryWebhookStore();
    const handler = vi.fn(async () => { throw new Error("db down"); });
    await expect(processOnce(store, "stripe", "evt_2", handler)).rejects.toThrow("db down");
    const retry = vi.fn(async () => {});
    expect(await processOnce(store, "stripe", "evt_2", retry)).toBe("processed");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

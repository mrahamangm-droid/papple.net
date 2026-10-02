import { describe, expect, it, vi } from "vitest";
import { createAuditWriter, hashIp, redact } from "./audit";

describe("redact", () => {
  it("masks sensitive keys at any depth without mutating the input", () => {
    const input = { password: "x", nested: { apiKey: "y", list: [{ token: "t" }] }, ok: 1 };
    const out = redact(input) as typeof input;
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect((out.nested.list[0] as { token: string }).token).toBe("[REDACTED]");
    expect(out.ok).toBe(1);
    expect(input.password).toBe("x");
  });
  it("passes through null, undefined and primitives", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(5)).toBe(5);
  });
});

describe("hashIp", () => {
  it("is deterministic per salt, hex sha256, and never the raw ip", () => {
    const a = hashIp("203.0.113.9", "salt1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hashIp("203.0.113.9", "salt1"));
    expect(a).not.toBe(hashIp("203.0.113.9", "salt2"));
    expect(a).not.toContain("203.0.113.9");
  });
});

describe("createAuditWriter", () => {
  it("inserts a redacted row with a hashed ip and request id", async () => {
    const insert = vi.fn(async (_row: Record<string, unknown>) => {});
    const writeAudit = createAuditWriter(insert, "salt");
    await writeAudit({
      actorId: "u1", action: "settings.update", entity: "platform_settings", entityId: "k",
      before: { password: "old" }, after: { v: 2 }, requestId: "req-1", ip: "203.0.113.9", outcome: "success",
    });
    const row = insert.mock.calls[0]![0];
    expect(row.actor_id).toBe("u1");
    expect(row.request_id).toBe("req-1");
    expect(row.ip_hash).toBe(hashIp("203.0.113.9", "salt"));
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    expect(JSON.stringify(row)).not.toContain("old");
  });
});

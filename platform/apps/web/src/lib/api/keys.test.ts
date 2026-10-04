import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bearerSecret, generateApiKey, hashApiKey, KEY_PATTERN } from "./keys";

describe("generateApiKey", () => {
  it("makes a pap_ secret of 43 url-safe characters", () => {
    const k = generateApiKey();
    expect(k.secret).toMatch(KEY_PATTERN);
    expect(k.secret.length).toBe(47);
  });
  it("derives the display prefix from the secret and never contains the whole secret", () => {
    const k = generateApiKey();
    expect(k.secret.startsWith(`pap_${k.prefix}`)).toBe(true);
    expect(k.prefix).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
  it("stores a sha256 hex of the secret", () => {
    const k = generateApiKey();
    expect(k.hash).toBe(createHash("sha256").update(k.secret).digest("hex"));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is random on every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateApiKey().secret));
    expect(seen.size).toBe(50);
  });
  it("uses the injected random source", () => {
    const k = generateApiKey(() => Buffer.alloc(32, 7));
    expect(k.secret).toBe(`pap_${Buffer.alloc(32, 7).toString("base64url")}`);
  });
});

describe("hashApiKey", () => {
  it("is deterministic and different for different secrets", () => {
    expect(hashApiKey("pap_a")).toBe(hashApiKey("pap_a"));
    expect(hashApiKey("pap_a")).not.toBe(hashApiKey("pap_b"));
  });
});

describe("bearerSecret", () => {
  const good = `pap_${"A".repeat(43)}`;
  it("takes a well formed bearer token", () => expect(bearerSecret(`Bearer ${good}`)).toBe(good));
  it("accepts the scheme in any case", () => expect(bearerSecret(`bearer ${good}`)).toBe(good));
  it("rejects missing, wrong scheme, wrong shape, extra parts", () => {
    for (const h of [null, "", good, `Basic ${good}`, "Bearer ", "Bearer nope", `Bearer ${good} extra`, `Bearer ${good}x`, `Bearer pap_${"A".repeat(42)}`, `Bearer pap_${"!".repeat(43)}`]) {
      expect(bearerSecret(h)).toBeNull();
    }
  });
});

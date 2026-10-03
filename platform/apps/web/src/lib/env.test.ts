import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-value-123",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret-value",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "akid",
  R2_SECRET_ACCESS_KEY: "r2-secret-value",
  R2_BUCKET: "papple-private",
};

describe("parseServerEnv", () => {
  it("returns a typed object for valid input and allows optional keys to be absent", () => {
    const env = parseServerEnv(valid);
    expect(env.R2_BUCKET).toBe("papple-private");
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it("names the missing key and never prints any provided secret value", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...rest } = valid;
    let message = "";
    try {
      parseServerEnv(rest);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(message).not.toContain("r2-secret-value");
    expect(message).not.toContain("anon-value-123");
  });

  it("rejects a non-URL Supabase URL by key name without echoing the value", () => {
    let message = "";
    try {
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not-a-url-secret" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).not.toContain("not-a-url-secret");
  });
});

describe("AI environment", () => {
  it("is optional and never required to boot", () => {
    const e = parseServerEnv(valid);
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.AI_MODEL).toBeUndefined();
  });
  it("accepts a key and model and never echoes the key in errors", () => {
    expect(parseServerEnv({ ...valid, ANTHROPIC_API_KEY: "sk-ant-secret", AI_MODEL: "claude-sonnet-5-5" }).AI_MODEL).toBe("claude-sonnet-5-5");
    expect(() => parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "", ANTHROPIC_API_KEY: "sk-ant-secret" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    try { parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "", ANTHROPIC_API_KEY: "sk-ant-secret" }); } catch (e) { expect(String(e)).not.toContain("sk-ant-secret"); }
  });
});

describe("parsePublicEnv", () => {
  it("only exposes public keys", () => {
    const env = parsePublicEnv(valid);
    expect(Object.keys(env).every((k) => k.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });
});

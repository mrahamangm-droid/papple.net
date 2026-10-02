import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

const opts = { isDev: false, supabaseUrl: "https://abc.supabase.co" };

describe("buildSecurityHeaders", () => {
  const h = buildSecurityHeaders("NONCE123", opts);
  const csp = h["Content-Security-Policy"]!;

  it("sets a nonce-based script policy with strict-dynamic and no unsafe-inline or unsafe-eval in production", () => {
    const script = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src"))!;
    expect(script).toContain("'nonce-NONCE123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });
  it("forbids framing, plugins and foreign form posts", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
  it("allows only the configured Supabase origin (https and wss) for connections", () => {
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
  });
  it("allows unsafe-eval only in development", () => {
    expect(buildSecurityHeaders("N", { ...opts, isDev: true })["Content-Security-Policy"]).toContain("'unsafe-eval'");
  });
  it("sets the other baseline headers", () => {
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
  it("produces a CSP without newlines", () => {
    expect(csp).not.toMatch(/\n/);
  });
});

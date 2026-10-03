import { describe, expect, it, vi } from "vitest";
import { RULES, RateLimitError, createMemoryLimiter, createRateLimiter, createUpstashLimiter, enforce } from "./ratelimit";

describe("memory limiter", () => {
  it("allows 5 calls and rejects the 6th with a positive reset", async () => {
    const t = 0;
    const l = createMemoryLimiter(() => t);
    for (let i = 0; i < 5; i++) expect((await l.check("k", 5, 60)).allowed).toBe(true);
    const sixth = await l.check("k", 5, 60);
    expect(sixth.allowed).toBe(false);
    expect(sixth.resetSec).toBeGreaterThan(0);
  });
  it("counts remaining down", async () => {
    const l = createMemoryLimiter(() => 0);
    expect((await l.check("k", 3, 60)).remaining).toBe(2);
    expect((await l.check("k", 3, 60)).remaining).toBe(1);
  });
  it("re-allows after the window expires", async () => {
    let t = 0;
    const l = createMemoryLimiter(() => t);
    for (let i = 0; i < 5; i++) await l.check("k", 5, 60);
    expect((await l.check("k", 5, 60)).allowed).toBe(false);
    t += 61_000;
    expect((await l.check("k", 5, 60)).allowed).toBe(true);
  });
  it("keeps keys independent", async () => {
    const l = createMemoryLimiter(() => 0);
    for (let i = 0; i < 5; i++) await l.check("a", 5, 60);
    expect((await l.check("a", 5, 60)).allowed).toBe(false);
    expect((await l.check("b", 5, 60)).allowed).toBe(true);
  });
});

describe("enforce", () => {
  it("throws RateLimitError carrying Retry-After seconds", async () => {
    const l = createMemoryLimiter(() => 0);
    for (let i = 0; i < RULES.auth.limit; i++) await enforce(l, "k", RULES.auth);
    const err = await enforce(l, "k", RULES.auth).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSec).toBeGreaterThan(0);
  });
  it("uses the spec's rules: auth 5/min, onboarding 10/min", () => {
    expect(RULES.auth).toEqual({ limit: 5, windowSec: 60 });
    expect(RULES.onboarding).toEqual({ limit: 10, windowSec: 60 });
  });
});

describe("upstash limiter", () => {
  const cfg = { url: "https://redis.example", token: "tok" };
  it("uses INCR + EXPIRE NX through the REST pipeline and maps the reply", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(JSON.stringify([{ result: 2 }, { result: 1 }, { result: 40 }])));
    const l = createUpstashLimiter(cfg, fetchMock as unknown as typeof fetch);
    const r = await l.check("k", 5, 60);
    expect(r).toEqual({ allowed: true, remaining: 3, resetSec: 40 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://redis.example/pipeline");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init!.body as string)).toEqual([["INCR", "rl:k"], ["EXPIRE", "rl:k", 60, "NX"], ["TTL", "rl:k"]]);
  });
  it("denies once the counter exceeds the limit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ result: 6 }, { result: 0 }, { result: 12 }])));
    const r = await createUpstashLimiter(cfg, fetchMock as unknown as typeof fetch).check("k", 5, 60);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});

describe("createRateLimiter", () => {
  it("falls back to in-memory limiting if Upstash errors (still enforcing)", async () => {
    const failing = vi.fn(async () => { throw new Error("network down"); });
    const l = createRateLimiter(
      { UPSTASH_REDIS_REST_URL: "https://r.example", UPSTASH_REDIS_REST_TOKEN: "t" },
      { fetch: failing as unknown as typeof fetch, now: () => 0 },
    );
    for (let i = 0; i < 5; i++) expect((await l.check("k", 5, 60)).allowed).toBe(true);
    expect((await l.check("k", 5, 60)).allowed).toBe(false);
  });
  it("uses memory when Upstash is not configured", async () => {
    const l = createRateLimiter({}, { now: () => 0 });
    expect((await l.check("k", 1, 60)).allowed).toBe(true);
    expect((await l.check("k", 1, 60)).allowed).toBe(false);
  });
});

describe("marketplace rules", () => {
  it("defines the marketplace limits", () => {
    expect(RULES.search).toEqual({ limit: 60, windowSec: 60 });
    expect(RULES.proposal).toEqual({ limit: 10, windowSec: 60 });
    expect(RULES.message).toEqual({ limit: 30, windowSec: 60 });
    expect(RULES.report).toEqual({ limit: 5, windowSec: 60 });
    expect(RULES.conversation).toEqual({ limit: 10, windowSec: 60 });
    expect(RULES.contract).toEqual({ limit: 30, windowSec: 60 });
    expect(RULES.checkout).toEqual({ limit: 10, windowSec: 60 });
    expect(RULES.dispute).toEqual({ limit: 5, windowSec: 60 });
    expect(RULES.review).toEqual({ limit: 5, windowSec: 60 });
  });
});

describe("hardening rules", () => {
  it("covers verification requests and signed downloads", () => {
    expect(RULES.verification.limit).toBeLessThanOrEqual(10);
    expect(RULES.filesign.limit).toBeGreaterThan(0);
  });
});

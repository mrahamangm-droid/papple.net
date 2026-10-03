export interface RateLimitResult { allowed: boolean; remaining: number; resetSec: number }
export interface RateLimiter {
  check(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}
export interface Rule { limit: number; windowSec: number }

export const RULES = {
  auth: { limit: 5, windowSec: 60 },
  onboarding: { limit: 10, windowSec: 60 },
  uploads: { limit: 30, windowSec: 60 },
  search: { limit: 60, windowSec: 60 },
  proposal: { limit: 10, windowSec: 60 },
  message: { limit: 30, windowSec: 60 },
  report: { limit: 5, windowSec: 60 },
  conversation: { limit: 10, windowSec: 60 },
  contract: { limit: 30, windowSec: 60 },
  checkout: { limit: 10, windowSec: 60 },
  dispute: { limit: 5, windowSec: 60 },
  review: { limit: 5, windowSec: 60 },
  verification: { limit: 5, windowSec: 600 },
  filesign: { limit: 120, windowSec: 60 },
  ai: { limit: 10, windowSec: 60 },
  billing: { limit: 10, windowSec: 60 },
  invoice: { limit: 20, windowSec: 60 },
} as const satisfies Record<string, Rule>;

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

export async function enforce(limiter: RateLimiter, key: string, rule: Rule): Promise<void> {
  const r = await limiter.check(key, rule.limit, rule.windowSec);
  if (!r.allowed) throw new RateLimitError(Math.max(1, r.resetSec));
}

/** Fixed-window limiter. Per-process: effective per serverless instance, not globally exact. */
export function createMemoryLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async check(key, limit, windowSec) {
      const t = now();
      let b = buckets.get(key);
      if (!b || t >= b.resetAt) {
        b = { count: 0, resetAt: t + windowSec * 1000 };
        buckets.set(key, b);
      }
      b.count += 1;
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (t >= v.resetAt) buckets.delete(k);
      return {
        allowed: b.count <= limit,
        remaining: Math.max(0, limit - b.count),
        resetSec: Math.ceil((b.resetAt - t) / 1000),
      };
    },
  };
}

/** Globally consistent fixed-window limiter over the Upstash REST API (INCR + EXPIRE NX + TTL in one round trip). */
export function createUpstashLimiter(cfg: { url: string; token: string }, fetchImpl: typeof fetch = fetch): RateLimiter {
  return {
    async check(key, limit, windowSec) {
      const k = `rl:${key}`;
      const res = await fetchImpl(`${cfg.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", k], ["EXPIRE", k, windowSec, "NX"], ["TTL", k]]),
      });
      if (!res.ok) throw new Error(`upstash ${res.status}`);
      const out = (await res.json()) as { result: number }[];
      const count = Number(out[0]?.result);
      const ttl = Number(out[2]?.result);
      if (!Number.isFinite(count)) throw new Error("upstash bad reply");
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec: ttl > 0 ? ttl : windowSec };
    },
  };
}

export function createRateLimiter(
  env: { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string },
  opts: { fetch?: typeof fetch; now?: () => number } = {},
): RateLimiter {
  const memory = createMemoryLimiter(opts.now);
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return memory;
  const remote = createUpstashLimiter({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }, opts.fetch);
  return {
    async check(key, limit, windowSec) {
      try {
        return await remote.check(key, limit, windowSec);
      } catch {
        return memory.check(key, limit, windowSec); // degrade to per-instance limiting rather than failing open
      }
    },
  };
}

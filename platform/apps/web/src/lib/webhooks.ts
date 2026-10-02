import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generic timestamped HMAC-SHA256 verification (signed content = `${timestamp}.${payload}`, hex signature).
 * Providers with their own scheme (e.g. Stripe) must use the provider's verifier; this is the shared fallback.
 */
export function verifyHmacSignature(opts: {
  payload: string;
  signature: string;
  secret: string;
  timestamp: number; // unix seconds
  toleranceSec?: number;
  now?: () => number; // ms
}): boolean {
  const tolerance = opts.toleranceSec ?? 300;
  const nowSec = (opts.now ?? Date.now)() / 1000;
  if (!Number.isFinite(opts.timestamp) || Math.abs(nowSec - opts.timestamp) > tolerance) return false;
  if (!/^[0-9a-f]{64}$/i.test(opts.signature)) return false;
  const expected = createHmac("sha256", opts.secret).update(`${opts.timestamp}.${opts.payload}`).digest();
  return timingSafeEqual(expected, Buffer.from(opts.signature, "hex"));
}

export interface WebhookStore {
  /** Atomically claim an event. Returns false if it was already claimed. */
  claim(provider: string, eventId: string, payload?: unknown): Promise<boolean>;
  markProcessed(provider: string, eventId: string): Promise<void>;
  release(provider: string, eventId: string): Promise<void>;
}

export async function processOnce(
  store: WebhookStore,
  provider: string,
  eventId: string,
  handler: () => Promise<void>,
  payload?: unknown,
): Promise<"processed" | "duplicate"> {
  if (!(await store.claim(provider, eventId, payload))) return "duplicate";
  try {
    await handler();
  } catch (e) {
    await store.release(provider, eventId); // let the provider's retry run again
    throw e;
  }
  await store.markProcessed(provider, eventId);
  return "processed";
}

export function createMemoryWebhookStore(): WebhookStore {
  const seen = new Set<string>();
  const k = (p: string, e: string) => `${p}\u0000${e}`;
  return {
    async claim(p, e) {
      if (seen.has(k(p, e))) return false;
      seen.add(k(p, e));
      return true;
    },
    async markProcessed() {},
    async release(p, e) {
      seen.delete(k(p, e));
    },
  };
}

/** Postgres-backed store (service-role client). The primary key makes the claim atomic across instances. */
export function createDbWebhookStore(db: SupabaseClient): WebhookStore {
  return {
    async claim(provider, eventId, payload) {
      const { error } = await db.from("webhook_events").insert({ provider, event_id: eventId, payload: payload ?? {} });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`webhook claim failed: ${error.message}`);
    },
    async markProcessed(provider, eventId) {
      await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("provider", provider).eq("event_id", eventId);
    },
    async release(provider, eventId) {
      await db.from("webhook_events").delete().eq("provider", provider).eq("event_id", eventId);
    },
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SEC = 300;

/** Svix scheme (used by Resend): HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 key after `whsec_`; header lists `v1,<base64>` entries. */
export function verifySvixSignature(opts: { secret: string; id: string; timestamp: string; signature: string; body: string; now?: () => number }): boolean {
  const { secret, id, timestamp, signature, body } = opts;
  if (!secret.startsWith("whsec_") || !id || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const nowSec = (opts.now ?? Date.now)() / 1000;
  if (Math.abs(nowSec - Number(timestamp)) > TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface ResendWebhookDeps {
  secret: string | undefined;
  /** Stores a suppression for the address of the message with this provider id; false when the id is unknown. */
  suppress: (providerId: string, reason: "bounce" | "complaint") => Promise<boolean>;
  now?: () => number;
}

export function createResendWebhook(deps: ResendWebhookDeps) {
  return {
    async handle(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }): Promise<{ status: number }> {
      if (!deps.secret) return { status: 503 };
      if (!verifySvixSignature({ secret: deps.secret, id: headers.id ?? "", timestamp: headers.timestamp ?? "", signature: headers.signature ?? "", body: rawBody, now: deps.now })) return { status: 401 };
      let event: { type?: unknown; data?: { email_id?: unknown; bounce?: { type?: unknown } } };
      try { event = JSON.parse(rawBody); } catch { return { status: 400 }; }
      const providerId = event?.data?.email_id;
      if (typeof event?.type !== "string" || typeof providerId !== "string" || providerId === "" || providerId.length > 200) return { status: 400 };
      const reason = event.type === "email.bounced" ? "bounce" : event.type === "email.complained" ? "complaint" : null;
      if (!reason) return { status: 200 };
      // A temporary failure (full mailbox, server down) says nothing about consent or validity; only permanent ones suppress.
      if (reason === "bounce" && typeof event.data?.bounce?.type === "string" && event.data.bounce.type.toLowerCase() === "transient") return { status: 200 };
      try {
        await deps.suppress(providerId, reason);
        return { status: 200 };
      } catch {
        return { status: 500 };
      }
    },
  };
}

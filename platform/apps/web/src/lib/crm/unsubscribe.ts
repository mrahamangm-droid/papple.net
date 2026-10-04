import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_TOKEN = 600;

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(`crm-unsubscribe-v1:${payload}`).digest();
}
const usable = (secret: string) => typeof secret === "string" && secret.length >= 16;

/** `<payload>.<signature>`, both base64url. The payload names the organization and the lower-cased address; nothing else is trusted. */
export function signUnsubscribeToken(secret: string, orgId: string, email: string): string {
  if (!usable(secret)) throw new Error("unsubscribe secret missing or too short");
  const addr = email.trim().toLowerCase();
  if (!UUID.test(orgId) || !EMAIL.test(addr) || addr.length > 254) throw new Error("invalid unsubscribe subject");
  const payload = Buffer.from(`${orgId.toLowerCase()}:${addr}`).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

export function verifyUnsubscribeToken(secret: string, token: string): { orgId: string; email: string } | null {
  if (!usable(secret) || typeof token !== "string" || token.length > MAX_TOKEN) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return null;
  const [payload, sig] = parts as [string, string];
  const given = Buffer.from(sig, "base64url");
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const text = Buffer.from(payload, "base64url").toString("utf8");
  const at = text.indexOf(":");
  const orgId = text.slice(0, at);
  const email = text.slice(at + 1);
  if (at < 0 || !UUID.test(orgId) || !EMAIL.test(email)) return null;
  return { orgId, email };
}

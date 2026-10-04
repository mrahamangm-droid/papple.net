import { createHash, randomBytes } from "node:crypto";

/** `pap_` plus 32 random bytes as 43 url-safe characters. */
export const KEY_PATTERN = /^pap_[A-Za-z0-9_-]{43}$/;

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** The secret is shown to the owner once; only the hash and a short display prefix are stored. */
export function generateApiKey(random: () => Buffer = () => randomBytes(32)): { secret: string; prefix: string; hash: string } {
  const secret = `pap_${random().toString("base64url")}`;
  return { secret, prefix: secret.slice(4, 12), hash: hashApiKey(secret) };
}

/** The key from an `Authorization: Bearer` header, or null when it is missing or not shaped like a key. */
export function bearerSecret(header: string | null): string | null {
  if (!header) return null;
  const m = /^bearer ([^\s]+)$/i.exec(header);
  return m && KEY_PATTERN.test(m[1]!) ? m[1]! : null;
}

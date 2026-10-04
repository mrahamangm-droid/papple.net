import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex digest: the only form of an invite token the database ever sees. */
export const hashInviteToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** 256 random bits, URL-safe. The token appears once, in the link shown to the inviter. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export const isInviteToken = (t: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(t);

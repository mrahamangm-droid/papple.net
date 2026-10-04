import { roleLabel } from "./present";

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Plain text, no tracking and no marketing: a one-off message the person asked the sender to send. Names are flattened so they cannot add headers or lines. */
export function buildInviteEmail(o: { orgName: string; inviterName: string; role: string; link: string }): { subject: string; text: string } {
  const org = clean(o.orgName, 120) || "an organization", who = clean(o.inviterName, 80) || "Someone";
  return {
    subject: `${who} invited you to join ${org} on PAPple`,
    text: `${who} invited you to join ${org} on PAPple as ${roleLabel(o.role)}.\n\nOpen this link while signed in with this email address to accept:\n${o.link}\n\nThe link works once and expires in 7 days. If you were not expecting this, you can ignore this email and nothing will happen.\n`,
  };
}

export interface InviteMailerConfig { apiKey: string; from: string; fetchImpl?: typeof fetch }

/** Resolves with the provider's message id; throws on any failure (the invite link exists either way). */
export function createInviteMailer(cfg: InviteMailerConfig) {
  return async (m: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<string | null> => {
    const res = await (cfg.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
      body: JSON.stringify({ from: cfg.from, to: m.to, subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`email provider ${res.status}`);
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof body?.id === "string" ? body.id : null;
  };
}

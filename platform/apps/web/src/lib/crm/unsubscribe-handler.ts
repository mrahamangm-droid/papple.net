import { verifyUnsubscribeToken } from "./unsubscribe";

export interface UnsubscribeDeps {
  secret: string | undefined;
  suppress: (orgId: string, email: string) => Promise<void>;
  /** Per-client limiter; false means too many requests. */
  throttle: () => Promise<boolean>;
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const BAD = page("This link is not valid", "<p>The unsubscribe link is invalid or incomplete. Reply to the message you received and ask the sender to remove you.</p>");

export function createUnsubscribeHandler(deps: UnsubscribeDeps) {
  /** A valid token is never throttled: one-click requests arrive from mailbox providers that share a few IP addresses, and the
   *  work (an HMAC check and an idempotent insert) is cheap. Only attempts with a bad token spend the client's allowance. */
  async function check(token: string | null): Promise<{ status: number; html: string } | { orgId: string; email: string }> {
    if (!deps.secret) return { status: 503, html: page("Unavailable", "<p>This service is not available right now. Please try again later.</p>") };
    const who = typeof token === "string" ? verifyUnsubscribeToken(deps.secret, token) : null;
    if (who) return who;
    let allowed = false;
    try { allowed = await deps.throttle(); } catch { allowed = false; }
    if (!allowed) return { status: 429, html: page("Too many requests", "<p>Please wait a minute and try again.</p>") };
    return { status: 400, html: BAD };
  }
  const isResult = (x: object): x is { status: number; html: string } => "status" in x;

  return {
    /** Shows a confirmation form. Nothing is stored: mail scanners open links, and must not unsubscribe people. */
    async get(token: string | null): Promise<{ status: number; html: string }> {
      const c = await check(token);
      if (isResult(c)) return c;
      return { status: 200, html: page("Unsubscribe", `<p>Stop receiving email from this sender?</p><form method="post"><button type="submit">Unsubscribe</button></form>`) };
    },
    /** Stores the suppression. Also the RFC 8058 one-click target. */
    async post(token: string | null): Promise<{ status: number; html: string }> {
      const c = await check(token);
      if (isResult(c)) return c;
      try {
        await deps.suppress(c.orgId, c.email);
      } catch {
        return { status: 500, html: page("Something went wrong", "<p>We could not record your request. Please try again.</p>") };
      }
      return { status: 200, html: page("You are unsubscribed", "<p>You will not receive further email from this sender.</p>") };
    },
  };
}

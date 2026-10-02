const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SENSITIVE_HEADERS = new Set(["cookie", "set-cookie", "authorization", "x-api-key", "proxy-authorization"]);

function maskStrings(v: unknown): unknown {
  if (typeof v === "string") return v.replace(JWT, "[token]").replace(EMAIL, "[email]");
  if (Array.isArray(v)) return v.map(maskStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskStrings(x)]));
  return v;
}

/** Sentry `beforeSend`: strips credentials and personal data. Returns a scrubbed copy. */
export function scrubEvent<T extends object>(event: T): T {
  const e = maskStrings(structuredClone(event)) as Record<string, unknown>;
  const req = e.request as { headers?: Record<string, string>; cookies?: unknown } | undefined;
  if (req) {
    delete req.cookies;
    if (req.headers) for (const k of Object.keys(req.headers)) if (SENSITIVE_HEADERS.has(k.toLowerCase())) delete req.headers[k];
  }
  const user = e.user as { id?: unknown } | undefined;
  if (user) e.user = user.id === undefined ? {} : { id: user.id };
  return e as T;
}

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/** CSP connect-src origins needed by configured monitoring/analytics (none when unconfigured). */
export function connectSources(env: { SENTRY_DSN?: string; NEXT_PUBLIC_POSTHOG_KEY?: string; NEXT_PUBLIC_POSTHOG_HOST?: string }): string[] {
  const out: string[] = [];
  if (env.SENTRY_DSN) {
    try {
      out.push(`https://${new URL(env.SENTRY_DSN).host}`);
    } catch {
      /* malformed DSN: ignore */
    }
  }
  if (env.NEXT_PUBLIC_POSTHOG_KEY) out.push(env.NEXT_PUBLIC_POSTHOG_HOST ?? POSTHOG_DEFAULT_HOST);
  return out;
}

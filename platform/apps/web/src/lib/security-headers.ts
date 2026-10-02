export interface HeaderOptions {
  isDev: boolean;
  supabaseUrl: string;
  /** Extra connect-src origins (e.g. analytics after consent). */
  extraConnectSrc?: string[];
}

export function buildSecurityHeaders(nonce: string, o: HeaderOptions): Record<string, string> {
  const supa = new URL(o.supabaseUrl);
  const connect = ["'self'", `https://${supa.host}`, `wss://${supa.host}`, ...(o.extraConnectSrc ?? [])].join(" ");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${o.isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${o.isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

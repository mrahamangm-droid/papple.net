/** Accepts only same-origin absolute paths; everything else falls back. Prevents open redirects. */
export function safeRedirect(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // reject backslashes and control characters anywhere (browsers normalise "\" to "/" and strip tabs/newlines)
   
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://localhost");
    if (u.origin !== "http://localhost") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

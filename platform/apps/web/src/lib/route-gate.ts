/** Optimistic gate for signed-out visitors. Pages and actions still re-check on the server. */
const PREFIXES = ["/dashboard", "/admin", "/onboarding", "/settings", "/projects", "/contracts", "/messages", "/notifications", "/profile"];
/** Exact only: `/services` is the provider's manager, while `/services/<slug>` is a public page. */
const EXACT = ["/services"];

export function isProtectedPath(path: string): boolean {
  return EXACT.includes(path) || PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

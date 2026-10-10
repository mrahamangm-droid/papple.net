/** Optimistic gate for signed-out visitors. Pages and actions still re-check on the server. */
export const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/onboarding", "/settings", "/projects", "/contracts", "/crm", "/talent", "/invitations", "/analytics", "/approvals", "/invite", "/messages", "/notifications", "/profile"] as const;
/** Exact only: `/services` is the provider's manager, while `/services/<slug>` is a public page. */
export const PROTECTED_EXACT = ["/services"] as const;

export function isProtectedPath(path: string): boolean {
  return (PROTECTED_EXACT as readonly string[]).includes(path) || PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

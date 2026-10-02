/** True if any Supabase auth cookie (including chunked `.0`, `.1` parts) is present. Anonymous visitors skip the Auth round trip. */
export function hasAuthCookie(names: string[]): boolean {
  return names.some((n) => /^sb-.+-auth-token(\.\d+)?$/.test(n));
}

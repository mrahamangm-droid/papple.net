const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidSlug = (s: string): boolean => s.length >= 1 && s.length <= 70 && SLUG_RE.test(s);

type Fetch = (view: "public_provider_cards" | "public_service_cards", slug: string) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Single-card lookups on the whitelisted public views. A malformed slug never reaches the database. */
export function createPublicData(deps: { fetchOne: Fetch }) {
  async function one<T>(view: Parameters<Fetch>[0], slug: string): Promise<T | null> {
    if (!isValidSlug(slug)) return null;
    const { data, error } = await deps.fetchOne(view, slug);
    if (error) throw new Error("Public data is temporarily unavailable"); // never echo database text
    return (data as T | null) ?? null;
  }
  return {
    provider: <T = Record<string, unknown>>(slug: string) => one<T>("public_provider_cards", slug),
    service: <T = Record<string, unknown>>(slug: string) => one<T>("public_service_cards", slug),
  };
}

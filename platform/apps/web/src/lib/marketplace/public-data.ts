const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidSlug = (s: string): boolean => s.length >= 1 && s.length <= 70 && SLUG_RE.test(s);

type Fetch = (view: "public_provider_cards" | "public_service_cards" | "public_provider_ratings", slug: string) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Single-card lookups on the whitelisted public views. A malformed slug never reaches the database. */
export interface PublicCredential { kind: string; title: string; issuer: string; issuedOn: string | null; expiresOn: string | null; status: "checked" | "declared" | "expired" }
type FetchMany = (slug: string) => Promise<{ data: unknown; error: { message: string } | null }>;
const isStatus = (s: unknown): s is PublicCredential["status"] => s === "checked" || s === "declared" || s === "expired";

export function createPublicData(deps: { fetchOne: Fetch; fetchMany?: FetchMany }) {
  async function one<T>(view: Parameters<Fetch>[0], slug: string): Promise<T | null> {
    if (!isValidSlug(slug)) return null;
    const { data, error } = await deps.fetchOne(view, slug);
    if (error) throw new Error("Public data is temporarily unavailable"); // never echo database text
    return (data as T | null) ?? null;
  }
  return {
    provider: <T = Record<string, unknown>>(slug: string) => one<T>("public_provider_cards", slug),
    service: <T = Record<string, unknown>>(slug: string) => one<T>("public_service_cards", slug),
    /** Public credentials of one profile. Anything unexpected is dropped, and a failure degrades to "none" rather than breaking the profile page. */
    credentials: async (slug: string): Promise<PublicCredential[]> => {
      if (!isValidSlug(slug) || !deps.fetchMany) return [];
      try {
        const { data, error } = await deps.fetchMany(slug);
        if (error || !Array.isArray(data)) return [];
        return data.flatMap((r: Record<string, unknown>) =>
          typeof r?.title === "string" && typeof r.issuer === "string" && typeof r.kind === "string" && isStatus(r.status)
            ? [{ kind: r.kind, title: r.title, issuer: r.issuer, issuedOn: (r.issued_on as string | null) ?? null, expiresOn: (r.expires_on as string | null) ?? null, status: r.status }] : []);
      } catch {
        return [];
      }
    },
    /** Aggregate of published reviews only. A failure here must never break a profile page, so it degrades to "no rating". */
    rating: async (slug: string): Promise<{ avg: number | null; count: number }> => {
      try {
        const row = await one<{ rating_avg: number | string | null; rating_count: number | null }>("public_provider_ratings", slug);
        const count = Number(row?.rating_count ?? 0);
        if (!row || !count || row.rating_avg == null) return { avg: null, count: 0 };
        return { avg: Number(row.rating_avg), count };
      } catch {
        return { avg: null, count: 0 };
      }
    },
  };
}

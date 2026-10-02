import { decodeCursor, encodeCursor, type SearchParams } from "./validators";

export interface ProviderCard {
  id: string; slug: string; headline: string; summary: string; display_name: string; entity_type: string;
  country: string | null; languages: string[]; hourly_min: number | null; hourly_max: number | null;
  currency: string; availability: string; updated_at: string; skills: string[]; verified?: boolean;
}
export interface ServiceCard {
  id: string; slug: string; title: string; description: string; pricing_model: string; price_min: number | null;
  currency: string; delivery_days: number | null; category_id: string | null; updated_at: string;
  provider_id: string; provider_slug: string; provider_headline: string; provider_name: string;
}
export interface Page<T> { items: T[]; nextCursor: string | null }

export class SearchError extends Error {
  constructor() {
    super("Search is temporarily unavailable");
    this.name = "SearchError";
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
interface Row<T> { card: T; rank: number; id: string }

export function createSearch(deps: { rpc: Rpc; pageSize: () => Promise<number> }) {
  async function run<T>(fn: string, args: Record<string, unknown>, cursor: string | undefined): Promise<Page<T>> {
    const size = await deps.pageSize();
    const c = decodeCursor(cursor);
    const { data, error } = await deps.rpc(fn, { ...args, p_after_rank: c?.rank ?? null, p_after_id: c?.id ?? null, p_limit: size + 1 });
    if (error || !Array.isArray(data)) throw new SearchError(); // never echo database messages
    const rows = data as Row<T>[];
    const page = rows.slice(0, size);
    const last = rows.length > size ? page[page.length - 1] : undefined;
    return { items: page.map((r) => r.card), nextCursor: last ? encodeCursor(last.rank, last.id) : null };
  }
  return {
    providers: (p: SearchParams) =>
      run<ProviderCard>("search_provider_cards", {
        p_q: p.q ?? null, p_category: p.category ?? null, p_skill_ids: p.skills ?? null, p_country: p.country ?? null,
        p_rate_max: p.rate_max ?? null, p_availability: p.availability ?? null,
      }, p.cursor),
    services: (p: SearchParams) =>
      run<ServiceCard>("search_service_cards", { p_q: p.q ?? null, p_category: p.category ?? null, p_price_max: p.price_max ?? null }, p.cursor),
  };
}

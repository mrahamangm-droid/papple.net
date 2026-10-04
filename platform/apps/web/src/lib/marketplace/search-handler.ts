import { searchParams, type SearchParams } from "./validators";
import { createGuardedSearch } from "./guarded-search";
import type { Page } from "./search";

type Search = { [K in "providers" | "services"]: (p: SearchParams) => Promise<Page<unknown>> };

/** Anonymous-capable search endpoint: validates, throttles per IP (via guarded search), returns public cards only. */
export function createSearchHandler(deps: {
  search: Search;
  throttle: (rule: "search", key: string) => Promise<boolean>;
  ip: () => Promise<string>;
}) {
  const guarded = createGuardedSearch(deps);
  return async function GET(req: Request): Promise<Response> {
    const parsed = searchParams.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return Response.json({ error: "invalid_params" }, { status: 400 });
    const r = await guarded(parsed.data);
    if (r.status === "rate") return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
    if (r.status === "error") return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json({ items: r.page.items, nextCursor: r.page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  };
}

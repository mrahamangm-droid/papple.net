import type { Page } from "./search";
import type { SearchParams } from "./validators";

type Search = { [K in "providers" | "services"]: (p: SearchParams) => Promise<Page<unknown>> };
export type GuardedResult = { status: "ok"; page: Page<unknown> } | { status: "rate" } | { status: "error" };

/** The one way anonymous search runs: per-IP throttle first, generic failure after. Used by the API route and /explore. */
export function createGuardedSearch(deps: {
  search: Search;
  throttle: (rule: "search", key: string) => Promise<boolean>;
  ip: () => Promise<string>;
}) {
  return async function guarded(params: SearchParams): Promise<GuardedResult> {
    if (!(await deps.throttle("search", await deps.ip()))) return { status: "rate" };
    try {
      const page = params.kind === "providers" ? await deps.search.providers(params) : await deps.search.services(params);
      return { status: "ok", page };
    } catch {
      return { status: "error" };
    }
  };
}

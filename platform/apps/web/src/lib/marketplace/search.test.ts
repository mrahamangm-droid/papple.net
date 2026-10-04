import { describe, expect, it, vi } from "vitest";
import { createSearch, SearchError } from "./search";
import { encodeCursor } from "./validators";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const row = (n: number, rank: number) => ({ card: { id: U(n), slug: `s${n}`, headline: `H${n}` }, rank, id: U(n) });

function make(rows: unknown[], pageSize = 2, error: { message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data: error ? null : rows, error }));
  return { rpc, search: createSearch({ rpc, pageSize: async () => pageSize }) };
}

describe("createSearch.providers", () => {
  it("asks for pageSize + 1 rows and sets nextCursor only when an extra row exists", async () => {
    const { rpc, search } = make([row(1, 3), row(2, 2), row(3, 1)], 2);
    const out = await search.providers({ kind: "providers" });
    expect(rpc).toHaveBeenCalledWith("search_provider_cards", expect.objectContaining({ p_limit: 3 }));
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBe(encodeCursor(2, U(2)));
  });
  it("returns no nextCursor on the last page", async () => {
    const { search } = make([row(1, 3)], 2);
    expect((await search.providers({ kind: "providers" })).nextCursor).toBeNull();
  });
  it("passes a valid cursor through and nulls an invalid one", async () => {
    const good = make([]);
    await good.search.providers({ kind: "providers", cursor: encodeCursor(2.5, U(9)) });
    expect(good.rpc).toHaveBeenCalledWith("search_provider_cards", expect.objectContaining({ p_after_rank: 2.5, p_after_id: U(9) }));
    const bad = make([]);
    await bad.search.providers({ kind: "providers", cursor: "garbage" });
    expect(bad.rpc).toHaveBeenCalledWith("search_provider_cards", expect.objectContaining({ p_after_rank: null, p_after_id: null }));
  });
  it("maps filters to RPC parameters", async () => {
    const { rpc, search } = make([]);
    await search.providers({ kind: "providers", q: "arch", category: U(5), skills: [U(6)], country: "AE", rate_max: 100, availability: "available" });
    expect(rpc).toHaveBeenCalledWith("search_provider_cards", expect.objectContaining({
      p_q: "arch", p_category: U(5), p_skill_ids: [U(6)], p_country: "AE", p_rate_max: 100, p_availability: "available",
    }));
  });
  it("throws a SearchError with a generic message when the RPC fails", async () => {
    const { search } = make([], 2, { message: "relation secret_table does not exist" });
    await expect(search.providers({ kind: "providers" })).rejects.toThrow(SearchError);
    await expect(search.providers({ kind: "providers" })).rejects.toThrow("Search is temporarily unavailable");
  });
});

describe("createSearch.services", () => {
  it("calls the service RPC with price_max", async () => {
    const { rpc, search } = make([row(1, 1)], 5);
    const out = await search.services({ kind: "services", q: "design", price_max: 500000 });
    expect(rpc).toHaveBeenCalledWith("search_service_cards", expect.objectContaining({ p_q: "design", p_price_max: 500000, p_limit: 6 }));
    expect(out.items).toHaveLength(1);
  });
});

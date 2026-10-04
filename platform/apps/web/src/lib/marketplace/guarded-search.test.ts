import { describe, expect, it, vi } from "vitest";
import { createGuardedSearch } from "./guarded-search";

const page = { items: [], nextCursor: null };
function make(allow = true) {
  const search = { providers: vi.fn(async () => page), services: vi.fn(async () => page) };
  const throttle = vi.fn(async (_rule: "search", _key: string) => allow);
  return { search, throttle, guarded: createGuardedSearch({ search, throttle, ip: async () => "9.9.9.9" }) };
}

describe("guarded search", () => {
  it("throttles by IP before searching", async () => {
    const { guarded, throttle, search } = make();
    expect(await guarded({ kind: "providers" })).toEqual({ status: "ok", page });
    expect(throttle).toHaveBeenCalledWith("search", "9.9.9.9");
    expect(search.providers).toHaveBeenCalledTimes(1);
  });
  it("returns rate and never touches the database when throttled", async () => {
    const { guarded, search } = make(false);
    expect(await guarded({ kind: "services" })).toEqual({ status: "rate" });
    expect(search.services).not.toHaveBeenCalled();
    expect(search.providers).not.toHaveBeenCalled();
  });
  it("turns any search failure into a generic error status", async () => {
    const { guarded, search } = make();
    search.providers.mockRejectedValueOnce(new Error("relation secret does not exist"));
    expect(await guarded({ kind: "providers" })).toEqual({ status: "error" });
  });
});

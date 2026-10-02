import { describe, expect, it, vi } from "vitest";
import { createSearchHandler } from "./search-handler";

const req = (qs: string) => new Request(`http://x/api/search?${qs}`);
const page = { items: [{ id: "a", slug: "s", headline: "h" }], nextCursor: null };
function make(allow = () => true) {
  const search = { providers: vi.fn(async () => page), services: vi.fn(async () => page) };
  const throttle = vi.fn(async () => allow());
  return { search, throttle, handler: createSearchHandler({ search, throttle, ip: async () => "1.2.3.4" }) };
}

describe("GET /api/search handler", () => {
  it("returns 400 for an unknown kind and does not search", async () => {
    const { handler, search } = make();
    const res = await handler(req("kind=x"));
    expect(res.status).toBe(400);
    expect(search.providers).not.toHaveBeenCalled();
  });
  it("returns the page shape without org ids", async () => {
    const { handler } = make();
    const res = await handler(req("kind=providers&q=welder"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
    expect(JSON.stringify(body)).not.toMatch(/org_id/);
  });
  it("routes services to the services search", async () => {
    const { handler, search } = make();
    await handler(req("kind=services"));
    expect(search.services).toHaveBeenCalledTimes(1);
  });
  it("throttles per IP: the 61st call gets 429 with Retry-After", async () => {
    let n = 0;
    const { handler, throttle } = make(() => ++n <= 60);
    for (let i = 0; i < 60; i++) expect((await handler(req("kind=providers"))).status).toBe(200);
    const res = await handler(req("kind=providers"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(throttle).toHaveBeenLastCalledWith("search", "1.2.3.4");
  });
  it("hides database failures behind a generic 503", async () => {
    const { handler, search } = make();
    search.providers.mockRejectedValueOnce(new Error("relation secret_table does not exist"));
    const res = await handler(req("kind=providers"));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/secret_table/);
  });
});

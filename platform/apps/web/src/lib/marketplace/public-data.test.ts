import { describe, expect, it, vi } from "vitest";
import { createPublicData, isValidSlug } from "./public-data";

describe("isValidSlug", () => {
  it.each(["jane-doe", "a", "p-1a2b3c4d", "welder-2"])("accepts %s", (s) => expect(isValidSlug(s)).toBe(true));
  it.each(["", "Jane", "a b", "a--b", "-a", "a-", "a/b", "x".repeat(71), "../etc"])("rejects %j", (s) => expect(isValidSlug(s)).toBe(false));
});

describe("createPublicData", () => {
  it("returns null for a malformed slug without querying", async () => {
    const fetchOne = vi.fn();
    expect(await createPublicData({ fetchOne }).provider("NOT A SLUG")).toBeNull();
    expect(fetchOne).not.toHaveBeenCalled();
  });
  it("reads only the public views", async () => {
    const fetchOne = vi.fn(async (_v: string, _s: string) => ({ data: { slug: "a" } as unknown, error: null as { message: string } | null }));
    const d = createPublicData({ fetchOne });
    await d.provider("a");
    await d.service("a");
    expect(fetchOne.mock.calls.map((c) => c[0])).toEqual(["public_provider_cards", "public_service_cards"]);
  });
  it("returns null when nothing matches and throws generically on a database error", async () => {
    const none = createPublicData({ fetchOne: async () => ({ data: null, error: null }) });
    expect(await none.provider("a")).toBeNull();
    const bad = createPublicData({ fetchOne: async () => ({ data: null, error: { message: "relation x missing" } }) });
    await expect(bad.provider("a")).rejects.toThrow("Public data is temporarily unavailable");
  });
});

describe("createPublicData rating", () => {
  it("reads the aggregate view and coerces numeric strings", async () => {
    const fetchOne = vi.fn(async (_v: string, _s: string) => ({ data: { slug: "a", rating_avg: "4.50", rating_count: 2 } as unknown, error: null as { message: string } | null }));
    expect(await createPublicData({ fetchOne }).rating("a")).toEqual({ avg: 4.5, count: 2 });
    expect(fetchOne.mock.calls[0]![0]).toBe("public_provider_ratings");
  });
  it("is empty when there are no published reviews", async () => {
    expect(await createPublicData({ fetchOne: async () => ({ data: null, error: null }) }).rating("a")).toEqual({ avg: null, count: 0 });
  });
  it("is empty for a malformed slug without querying", async () => {
    const fetchOne = vi.fn();
    expect(await createPublicData({ fetchOne }).rating("NOT A SLUG")).toEqual({ avg: null, count: 0 });
    expect(fetchOne).not.toHaveBeenCalled();
  });
  it("never lets a ratings failure break a profile: it reports no rating", async () => {
    const bad = createPublicData({ fetchOne: async () => ({ data: null, error: { message: "boom" } }) });
    expect(await bad.rating("a")).toEqual({ avg: null, count: 0 });
  });
});


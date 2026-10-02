import { describe, expect, it } from "vitest";
import { DuplicateError, InvalidInputError, LimitError, MarketplaceError, NotAllowedError, mapDbError } from "./errors";

describe("mapDbError", () => {
  it.each([
    ["42501", NotAllowedError],
    ["22023", InvalidInputError],
    ["54000", LimitError],
    ["23505", DuplicateError],
  ])("maps postgres code %s", (code, cls) => {
    expect(mapDbError({ code, message: "secret internals" })).toBeInstanceOf(cls);
  });
  it("maps anything else to a generic MarketplaceError without leaking the database message", () => {
    const e = mapDbError({ code: "XX000", message: "relation internal_table failed" });
    expect(e).toBeInstanceOf(MarketplaceError);
    expect(e.message).not.toContain("internal_table");
  });
  it("never exposes the raw message on mapped errors either", () => {
    expect(mapDbError({ code: "22023", message: "invalid headline" }).message).not.toContain("headline");
  });
});

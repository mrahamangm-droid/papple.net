import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";

describe("BRAND", () => {
  it("names the company and tagline exactly", () => {
    expect(BRAND.company).toBe("Papple World FZE LLC");
    expect(BRAND.name).toBe("Papple");
    expect(BRAND.tagline).toBe("Global Professional Marketplace & AI Business Platform");
  });
});

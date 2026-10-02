import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("hyphenates ascii words and drops punctuation", () => {
    expect(slugify("Senior Architect — Dubai!")).toBe("senior-architect-dubai");
  });
  it.each(["مهندس", "😀", "   ", ""])("falls back to p-<hex> for %j", (input) => {
    expect(slugify(input, () => "deadbeef")).toBe("p-deadbeef");
  });
  it("uses a random 8-hex fallback by default", () => {
    expect(slugify("😀")).toMatch(/^p-[0-9a-f]{8}$/);
  });
  it("truncates to 60 characters without a trailing hyphen", () => {
    const s = slugify("abc ".repeat(60));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

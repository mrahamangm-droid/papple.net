import { describe, expect, it } from "vitest";
import { formatMinor, fromMinor, jsonLdScript, minorExponent, priceLabel, rateLabel, toMinor } from "./present";

describe("formatMinor", () => {
  it("formats minor units using the currency's own exponent", () => {
    expect(formatMinor(12345, "USD")).toBe("$123.45");
    expect(formatMinor(5000, "JPY")).toContain("5,000");
  });
  it("falls back gracefully for an unknown currency code", () => {
    expect(formatMinor(1000, "ZZZ")).toMatch(/10/);
  });
});
describe("labels", () => {
  it("priceLabel handles models", () => {
    expect(priceLabel({ pricing_model: "quote", price_min: null, currency: "USD" })).toBe("Custom quote");
    expect(priceLabel({ pricing_model: "fixed", price_min: 10000, currency: "USD" })).toBe("From $100.00");
    expect(priceLabel({ pricing_model: "hourly", price_min: 5000, currency: "USD" })).toBe("From $50.00 / hour");
  });
  it("rateLabel shows a band, a single rate, or nothing", () => {
    expect(rateLabel({ hourly_min: 4000, hourly_max: 8000, currency: "USD" })).toBe("$40.00–$80.00 / hour");
    expect(rateLabel({ hourly_min: 4000, hourly_max: null, currency: "USD" })).toBe("From $40.00 / hour");
    expect(rateLabel({ hourly_min: null, hourly_max: null, currency: "USD" })).toBeNull();
  });
});
describe("jsonLdScript", () => {
  it("escapes characters that could close the script element", () => {
    const out = jsonLdScript({ name: "</script><script>alert(1)</script>", n: "a b" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("currency exponents", () => {
  it("knows how many minor-unit digits a currency has", () => {
    expect(minorExponent("USD")).toBe(2);
    expect(minorExponent("JPY")).toBe(0);
    expect(minorExponent("KWD")).toBe(3);
    expect(minorExponent("ZZZ")).toBe(2);
  });
  it("converts typed amounts to minor units with the right factor", () => {
    expect(toMinor(10.5, "USD")).toBe(1050);
    expect(toMinor(5000, "JPY")).toBe(5000);
    expect(toMinor(10, "KWD")).toBe(10000);
    expect(toMinor(0.1 + 0.2, "USD")).toBe(30); // float noise must not leak into stored money
  });
  it("converts minor units back for display and structured data", () => {
    expect(fromMinor(1050, "USD")).toBe(10.5);
    expect(fromMinor(5000, "JPY")).toBe(5000);
    expect(fromMinor(10000, "KWD")).toBe(10);
  });
  it("round-trips what a user types and what the page shows", () => {
    for (const [amount, cur] of [[1500, "JPY"], [12.34, "USD"], [7.125, "KWD"]] as const) expect(fromMinor(toMinor(amount, cur), cur)).toBe(amount);
    expect(formatMinor(toMinor(5000, "JPY"), "JPY")).toContain("5,000");
    expect(formatMinor(toMinor(10, "KWD"), "KWD")).toContain("10.000");
  });
});

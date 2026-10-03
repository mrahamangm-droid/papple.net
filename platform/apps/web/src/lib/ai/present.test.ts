import { describe, expect, it } from "vitest";
import { FEATURE_LABEL, parseWindow, splitSummary } from "./present";

describe("parseWindow", () => {
  it.each([["7", 7], ["30", 30], ["90", 90]])("accepts %s", (raw, n) => expect(parseWindow(raw)).toBe(n));
  it.each([undefined, "", "1", "365", "abc", "-5", "7; drop"])("falls back to 30 for %s", (raw) => expect(parseWindow(raw)).toBe(30));
  it("reads the first of repeated parameters", () => expect(parseWindow(["90", "7"])).toBe(90));
});

describe("splitSummary", () => {
  const rows = [
    { kind: "feature", label: "proposal_draft", calls: 5, errors: 1, tokens_in: 100, tokens_out: 50 },
    { kind: "org", label: "Acme", calls: 4, errors: 0, tokens_in: 80, tokens_out: 40 },
    { kind: "feature", label: "mystery", calls: 1, errors: 0, tokens_in: 1, tokens_out: 1 },
  ];
  it("separates features from organizations and labels known features", () => {
    const s = splitSummary(rows);
    expect(s.features.map((f) => f.label)).toEqual([FEATURE_LABEL.proposal_draft, "mystery"]);
    expect(s.orgs.map((o) => o.label)).toEqual(["Acme"]);
  });
  it("totals calls and tokens across features only (orgs would double count)", () => {
    expect(splitSummary(rows).total).toEqual({ calls: 6, errors: 1, tokensIn: 101, tokensOut: 51 });
  });
  it("tolerates null or malformed input", () => {
    expect(splitSummary(null).total.calls).toBe(0);
    expect(splitSummary([{ nope: 1 }] as never).features).toEqual([]);
  });
});

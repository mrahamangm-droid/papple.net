import { describe, expect, it } from "vitest";
import { crmFailureMessage, describeImport, formatDealValue, stageLabel } from "./present";

describe("crm present", () => {
  it("labels stages and never throws on unknown ones", () => {
    expect(stageLabel("proposal")).toBe("Proposal sent");
    expect(stageLabel("zzz")).toBe("Unknown");
  });
  it("formats minor units with the currency code", () => {
    expect(formatDealValue(500000, "AED")).toBe("AED 5,000.00");
    expect(formatDealValue(null, null)).toBe("No value");
  });
  it("has a fixed message for every failure and never echoes server text", () => {
    expect(crmFailureMessage("limit")).toMatch(/plan/);
    expect(crmFailureMessage("duplicate")).toMatch(/already exists/);
    expect(crmFailureMessage("csv_no_name_column")).toMatch(/Name/);
    expect(crmFailureMessage("nope" as never)).toBe(crmFailureMessage("error"));
  });
  it("summarises an import including file lines and limits", () => {
    expect(describeImport({ imported: 3, duplicate: 0, invalidLines: [], limit: 0 })).toBe("3 imported.");
    const s = describeImport({ imported: 2, duplicate: 1, invalidLines: [4, 9], limit: 5 });
    expect(s).toContain("1 skipped as duplicates");
    expect(s).toContain("file lines 4, 9");
    expect(s).toContain("5 not imported");
  });
  it("truncates a long list of invalid lines", () => {
    const s = describeImport({ imported: 0, duplicate: 0, invalidLines: Array.from({ length: 30 }, (_, i) => i + 2), limit: 0 });
    expect(s).toContain("30 skipped");
    expect(s).toContain("…");
  });
});

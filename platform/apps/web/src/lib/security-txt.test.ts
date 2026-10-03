import { describe, expect, it } from "vitest";
import { buildSecurityTxt } from "./security-txt";

const now = new Date("2026-10-03T00:00:00Z");

describe("buildSecurityTxt", () => {
  it("states plainly that the contact is unconfirmed instead of inventing one", () => {
    const t = buildSecurityTxt(null, now);
    expect(t).not.toMatch(/^Contact:/m);
    expect(t).not.toContain("mailto:");
    expect(t).toMatch(/not yet confirmed/i);
  });
  it("publishes a confirmed contact with an Expires within a year", () => {
    const t = buildSecurityTxt("security@example.com", now);
    expect(t).toContain("Contact: mailto:security@example.com");
    const exp = /^Expires: (.+)$/m.exec(t)![1]!;
    expect(new Date(exp).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(exp).getTime()).toBeLessThanOrEqual(now.getTime() + 366 * 86400_000);
  });
  it("refuses a contact with line breaks (header injection)", () => {
    expect(buildSecurityTxt("a@b.co\nContact: evil", now)).not.toContain("evil");
  });
});

import { describe, expect, it } from "vitest";
import { billingMessage, describeSubscription } from "./present";

describe("billingMessage", () => {
  it("never echoes server text and covers every code", () => {
    for (const c of ["forbidden", "invalid", "rate", "unavailable", "error"] as const) expect(billingMessage(c).length).toBeGreaterThan(10);
    expect(billingMessage("forbidden")).toMatch(/owner/i);
  });
});

describe("describeSubscription", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  it("explains each state in plain words", () => {
    expect(describeSubscription(null, now, 7)).toMatch(/free/i);
    expect(describeSubscription({ status: "active", periodEnd: "2026-11-01T00:00:00Z", cancelAtPeriodEnd: false, pastDueSince: null }, now, 7)).toMatch(/renews on 1 Nov 2026/);
    expect(describeSubscription({ status: "active", periodEnd: "2026-11-01T00:00:00Z", cancelAtPeriodEnd: true, pastDueSince: null }, now, 7)).toMatch(/ends on 1 Nov 2026/);
    expect(describeSubscription({ status: "past_due", periodEnd: null, cancelAtPeriodEnd: false, pastDueSince: "2026-10-02T00:00:00Z" }, now, 7)).toMatch(/payment failed.*5 more days/i);
    expect(describeSubscription({ status: "past_due", periodEnd: null, cancelAtPeriodEnd: false, pastDueSince: "2026-09-01T00:00:00Z" }, now, 7)).toMatch(/free/i);
    expect(describeSubscription({ status: "canceled", periodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null }, now, 7)).toMatch(/cancelled.*free/i);
  });
});

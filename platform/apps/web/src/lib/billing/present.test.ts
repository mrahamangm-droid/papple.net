import { describe, expect, it } from "vitest";
import { billingMessage, describeSubscription, planPriceLine } from "./present";

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

describe("planPriceLine", () => {
  it("leads with the free month when the organization can still have it", () => {
    expect(planPriceLine({ price_cents: 2999, currency: "USD", interval: "month" }, 30)).toBe("30 days free, then $29.99 per month");
    expect(planPriceLine({ price_cents: 2999, currency: "USD", interval: "month" }, 0)).toBe("$29.99 per month");
    expect(planPriceLine({ price_cents: 9999, currency: "USD", interval: null }, 0)).toBe("$99.99");
  });
});

describe("trial", () => {
  it("says when the free trial ends and what happens next", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(describeSubscription({ status: "trialing", periodEnd: "2026-11-09T00:00:00Z", cancelAtPeriodEnd: false, pastDueSince: null }, now, 7))
      .toBe("Free trial until 9 Nov 2026, then the plan is charged monthly. Cancel before then and nothing is charged.");
    expect(describeSubscription({ status: "trialing", periodEnd: "2026-11-09T00:00:00Z", cancelAtPeriodEnd: true, pastDueSince: null }, now, 7))
      .toBe("Free trial until 9 Nov 2026. It is cancelled, so nothing will be charged.");
  });
});

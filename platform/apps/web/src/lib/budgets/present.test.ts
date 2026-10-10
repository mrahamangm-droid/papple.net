import { describe, expect, it } from "vitest";
import { acceptBudgetWarning, bookingBudgetWarning, budgetMeter, budgetSummary, requestReasonLabels } from "./present";
import type { BudgetStatus } from "./service";

const S: BudgetStatus = {
  enabled: true, period: "quarter", period_start: "2026-10-01T00:00:00+00:00", period_end: "2027-01-01T00:00:00+00:00",
  currency: "USD", limit: 1000000, spent: 620000, remaining: 380000, contracts: 600000, bookings: 20000, other_currency: 0,
};

describe("budgetMeter", () => {
  it("says how much is used this period", () => {
    expect(budgetMeter(S)).toEqual({ text: "$6,200.00 of $10,000.00 used this quarter", percent: 62, over: false, note: null });
    expect(budgetMeter({ ...S, period: "month", spent: 1200000, remaining: -200000 })).toEqual({
      text: "$12,000.00 of $10,000.00 used this month", percent: 100, over: true, note: "Over budget by $2,000.00.",
    });
  });
  it("mentions spend it could not add", () => {
    expect(budgetMeter({ ...S, other_currency: 2 })?.note).toBe("2 items in other currencies are not counted.");
    expect(budgetMeter({ ...S, other_currency: 1 })?.note).toBe("1 item in another currency is not counted.");
  });
  it("shows nothing when the budget is off or missing", () => {
    expect(budgetMeter({ ...S, enabled: false })).toBeNull();
    expect(budgetMeter(null)).toBeNull();
  });
});

describe("acceptBudgetWarning", () => {
  it("warns before going over, and tells an admin it goes to an owner", () => {
    expect(acceptBudgetWarning(S, 500000, "USD", true)).toBe("Accepting this contract goes over the budget by $1,200.00.");
    expect(acceptBudgetWarning(S, 500000, "USD", false)).toBe("Accepting this contract goes over the budget by $1,200.00, so it will be sent to an owner for approval.");
    expect(acceptBudgetWarning(S, 380000, "USD", false)).toBeNull();
  });
  it("explains a currency it cannot check", () => {
    expect(acceptBudgetWarning(S, 100, "EUR", false)).toBe("This contract is in EUR and the budget is in USD, so it will be sent to an owner for approval.");
    expect(acceptBudgetWarning(S, 100, "EUR", true)).toBeNull();
  });
  it("stays quiet without a budget", () => {
    expect(acceptBudgetWarning(null, 999999999, "USD", false)).toBeNull();
    expect(acceptBudgetWarning({ ...S, enabled: false }, 999999999, "USD", false)).toBeNull();
  });
});

describe("bookingBudgetWarning", () => {
  it("warns but never blocks", () => {
    expect(bookingBudgetWarning(S, 400000, "USD")).toBe("Paying this booking goes over your organization's budget by $200.00.");
    expect(bookingBudgetWarning(S, 1000, "USD")).toBeNull();
    expect(bookingBudgetWarning(S, 1000, "EUR")).toBeNull();
  });
});

describe("labels", () => {
  it("names the reasons a request needs an owner", () => {
    expect(requestReasonLabels(["threshold", "budget"])).toEqual(["Above the approval threshold", "Over budget"]);
    expect(requestReasonLabels(["other"])).toEqual([]);
  });
  it("summarizes the budget setting", () => {
    expect(budgetSummary({ enabled: true, period: "month", amount_minor: 500000, currency: "USD" }))
      .toBe("Budget: $5,000.00 per month. An admin accepting a contract that goes over it, or one in another currency, needs an owner's approval.");
    expect(budgetSummary(null)).toBe("No budget. Spending is not limited by period.");
  });
});

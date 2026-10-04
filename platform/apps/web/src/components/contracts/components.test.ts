import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContractStatusBadge } from "./ContractStatusBadge";
import { MilestoneList } from "./MilestoneList";
import { PaymentNotice } from "./PaymentNotice";
import { RatingSummary } from "./RatingSummary";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const m = (over = {}) => ({ id: "m1", position: 1, title: "Foundation drawings", description: "", amount: 40000, due_date: null, status: "pending", change_note: null, ...over });

describe("PaymentNotice", () => {
  it("tells the client they pay on approval and that Papple holds no funds", () => {
    const out = html(h(PaymentNotice, { side: "client" }));
    expect(out).toContain("when you approve");
    expect(out).toContain("does not hold");
  });
  it("tells the professional they are paid per approved milestone, straight to their own account", () => {
    const out = html(h(PaymentNotice, { side: "provider" }));
    expect(out).toContain("after the client approves");
    expect(out).toContain("your own payout account");
  });
});

describe("MilestoneList", () => {
  it("formats amounts with the currency's own decimals", () => {
    expect(html(h(MilestoneList, { milestones: [m()], currency: "JPY" }))).toContain("40,000");
    expect(html(h(MilestoneList, { milestones: [m()], currency: "KWD" }))).toContain("40.000");
    expect(html(h(MilestoneList, { milestones: [m()], currency: "USD" }))).toContain("400.00");
  });
  it("shows status copy, due dates and change requests", () => {
    const out = html(h(MilestoneList, { currency: "USD", milestones: [m({ status: "changes_requested", change_note: "Please fix the drawings", due_date: "2026-12-31" })] }));
    expect(out).toContain("Changes requested");
    expect(out).toContain("Please fix the drawings");
    expect(out).toContain("2026-12-31");
  });
  it("renders per-milestone actions from the caller and nothing else", () => {
    const out = html(h(MilestoneList, { currency: "USD", milestones: [m()], renderActions: (x) => h("button", null, `act-${x.id}`) }));
    expect(out).toContain("act-m1");
    expect(html(h(MilestoneList, { currency: "USD", milestones: [m()] }))).not.toContain("<button");
  });
  it("says so when there are no milestones", () => {
    expect(html(h(MilestoneList, { currency: "USD", milestones: [] }))).toContain("No milestones");
  });
  it("never renders payment or account identifiers", () => {
    const out = html(h(MilestoneList, { currency: "USD", milestones: [m({ status: "paid" })] }));
    expect(out).not.toMatch(/acct_|cs_|pi_/);
  });
});

describe("ContractStatusBadge", () => {
  it("shows a human label", () => {
    expect(html(h(ContractStatusBadge, { status: "disputed" }))).toContain("In dispute");
    expect(html(h(ContractStatusBadge, { status: "completed" }))).toContain("Completed");
  });
});

describe("RatingSummary", () => {
  it("shows the average and count", () => {
    const out = html(h(RatingSummary, { avg: 4.5, count: 2 }));
    expect(out).toContain("4.5");
    expect(out).toContain("2 reviews");
  });
  it("uses the singular for one review", () => {
    expect(html(h(RatingSummary, { avg: 5, count: 1 }))).toContain("1 review");
  });
  it("renders nothing when there are no published reviews", () => {
    expect(html(h(RatingSummary, { avg: null, count: 0 }))).toBe("");
  });
});

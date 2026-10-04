import { describe, expect, it } from "vitest";
import { analyticsFailureMessage, DEFINITIONS, formatDays, formatPct, normalizeDays, parseAnalytics, windowNote, type AnalyticsFailure } from "./present";

const good = {
  days: 30, requested_days: 30, capped: false, since: "2026-09-01T00:00:00Z",
  projects: { posted: 4, open: 1, closed: 2, cancelled: 1, other: 0 },
  proposals: { received: 5, shortlisted: 3, avg_per_project: 1.3 },
  hiring: { hired: 2, hire_rate_pct: 50, median_days_to_hire: 5.5 },
  contracts: { draft: 0, active: 1, completed: 1, disputed: 0, cancelled: 1 },
  money: [{ currency: "EUR", committed: 5000, paid: 0, client_fees: 0, refunded: 5000 }],
  top_providers: [{ name: "Provider One", currency: "USD", contracts: 1, committed: 10000 }],
  talent: { pools: 2, pooled: 2, invites_sent: 2, invites_declined: 1, proposals_from_invited: 1, invite_to_proposal_pct: 50 },
  monthly: [{ month: "2026-09", projects: 4, contracts: 2 }],
};

describe("parseAnalytics", () => {
  it("accepts a well-formed response", () => {
    const a = parseAnalytics(good);
    expect(a?.projects.posted).toBe(4);
    expect(a?.money[0].currency).toBe("EUR");
  });
  it("keeps null ratios as null", () => {
    const a = parseAnalytics({ ...good, proposals: { ...good.proposals, avg_per_project: null }, hiring: { hired: 0, hire_rate_pct: null, median_days_to_hire: null } });
    expect(a?.proposals.avg_per_project).toBeNull();
    expect(a?.hiring.hire_rate_pct).toBeNull();
  });
  it("rejects odd shapes instead of guessing", () => {
    expect(parseAnalytics(null)).toBeNull();
    expect(parseAnalytics("x")).toBeNull();
    expect(parseAnalytics({ ...good, projects: { posted: "4" } })).toBeNull();
    expect(parseAnalytics({ ...good, money: [{ currency: "usd", committed: 1, paid: 1, client_fees: 0, refunded: 0 }] })).toBeNull();
    expect(parseAnalytics({ ...good, money: [{ currency: "USD", committed: -1, paid: 1, client_fees: 0, refunded: 0 }] })).toBeNull();
  });
});

describe("definitions", () => {
  it("do not call a draft offer a hire and explain refunds", () => {
    const text = DEFINITIONS.map((d) => `${d.term} ${d.text}`).join(" ");
    expect(text).toMatch(/not a hire/);
    expect(text).toMatch(/amount plus the fee/);
  });
});

describe("formatters", () => {
  it("formats percentages without a trailing .0 and never fakes a zero", () => {
    expect(formatPct(50)).toBe("50%");
    expect(formatPct(33.3)).toBe("33.3%");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(null)).toBe("Not enough data yet");
  });
  it("formats days with the right plural", () => {
    expect(formatDays(5.5)).toBe("5.5 days");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(0)).toBe("0 days");
    expect(formatDays(null)).toBe("Not enough data yet");
  });
});

describe("normalizeDays", () => {
  it("accepts only 30, 90 and 365 and defaults to 30", () => {
    expect(normalizeDays("90")).toBe(90);
    expect(normalizeDays("365")).toBe(365);
    expect(normalizeDays("30")).toBe(30);
    expect(normalizeDays("7")).toBe(30);
    expect(normalizeDays("abc")).toBe(30);
    expect(normalizeDays(undefined)).toBe(30);
    expect(normalizeDays(["90", "30"])).toBe(90);
  });
});

describe("windowNote", () => {
  it("says nothing when not capped", () => {
    expect(windowNote({ days: 30, requested_days: 30, capped: false })).toBeNull();
  });
  it("explains a capped window", () => {
    expect(windowNote({ days: 30, requested_days: 365, capped: true })).toBe("Your plan shows up to 30 days of history, so this is the last 30 days instead of 365.");
  });
});

describe("analyticsFailureMessage", () => {
  it("has a distinct message per failure and hides unknown codes", () => {
    const codes: AnalyticsFailure[] = ["forbidden", "invalid", "rate", "error"];
    expect(new Set(codes.map(analyticsFailureMessage)).size).toBe(4);
    expect(analyticsFailureMessage("x" as AnalyticsFailure)).toBe(analyticsFailureMessage("error"));
  });
});

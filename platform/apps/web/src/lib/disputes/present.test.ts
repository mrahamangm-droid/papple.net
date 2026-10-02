import { describe, expect, it } from "vitest";
import { refundState, rulingChoices, sortQueue } from "./present";

describe("rulingChoices", () => {
  it("offers a refund only when a payment actually succeeded", () => {
    expect(rulingChoices(["succeeded", "pending"])).toEqual(["resume", "complete", "cancel", "refund_cancel"]);
    expect(rulingChoices(["pending", "failed"])).toEqual(["resume", "complete", "cancel"]);
    expect(rulingChoices([])).toEqual(["resume", "complete", "cancel"]);
  });
  it("does not offer a refund for a payment that is already refunded or being refunded", () => {
    expect(rulingChoices(["refunded", "refund_pending"])).not.toContain("refund_cancel");
  });
});

describe("sortQueue", () => {
  const rows = [{ id: "b", opened_at: "2026-10-02T10:00:00Z" }, { id: "a", opened_at: "2026-10-01T10:00:00Z" }, { id: "c", opened_at: "2026-10-03T10:00:00Z" }];
  it("puts the oldest dispute first without mutating the input", () => {
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].id).toBe("b");
  });
});

describe("refundState", () => {
  it("allows a retry only while a refund is pending", () => {
    expect(refundState([{ status: "pending" }, { status: "succeeded" }])).toEqual({ pending: 1, succeeded: 1, failed: 0, canRetry: true });
    expect(refundState([{ status: "succeeded" }])).toEqual({ pending: 0, succeeded: 1, failed: 0, canRetry: false });
    expect(refundState([])).toEqual({ pending: 0, succeeded: 0, failed: 0, canRetry: false });
  });
});

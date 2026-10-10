import { describe, expect, it } from "vitest";
import { bookingFailureMessage, bookingNotificationCopy, bookingPaymentState, bookingPriceLine, bookingRefundRule, clientCancelForfeits, bookingStatusLabel, groupSlotsByDay } from "./present";

const NOW = new Date("2027-01-04T12:00:00Z");

describe("bookingStatusLabel", () => {
  it("names each state and derives Expired for a pending booking in the past", () => {
    expect(bookingStatusLabel("pending", "2027-01-05T09:00:00Z", NOW)).toBe("Waiting for confirmation");
    expect(bookingStatusLabel("pending", "2027-01-04T09:00:00Z", NOW)).toBe("Expired");
    expect(bookingStatusLabel("confirmed", "2027-01-04T09:00:00Z", NOW)).toBe("Confirmed");
    expect(bookingStatusLabel("declined", "x", NOW)).toBe("Declined");
    expect(bookingStatusLabel("cancelled", "x", NOW)).toBe("Cancelled");
    expect(bookingStatusLabel("nope", "x", NOW)).toBe("Unknown");
  });
});

describe("groupSlotsByDay", () => {
  it("groups by the viewer's local day, splitting at local midnight", () => {
    // 14:30Z and 15:30Z are 23:30 and 00:30 next day in Tokyo (UTC+9)
    const g = groupSlotsByDay(["2027-01-04T14:30:00Z", "2027-01-04T15:30:00Z"], "Asia/Tokyo");
    expect(g.map((d) => d.day)).toEqual(["2027-01-04", "2027-01-05"]);
    expect(g[0]!.slots[0]!.time).toBe("23:30");
    expect(g[1]!.slots[0]!.time).toBe("00:30");
    expect(g[1]!.slots[0]!.iso).toBe("2027-01-04T15:30:00Z");
  });
});

describe("bookingNotificationCopy", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  it("links to the bookings of the organization told, without names or amounts", () => {
    for (const t of ["booking_requested", "booking_confirmed", "booking_declined", "booking_cancelled"]) {
      const c = bookingNotificationCopy(t, { booking_id: "b1", org_id: ORG })!;
      expect(c.href).toBe(`/bookings?org=${ORG}`);
      expect(c.text).not.toMatch(/\d/);
    }
    expect(bookingNotificationCopy("booking_requested", { org_id: "bad" })!.href).toBe("/bookings");
    expect(bookingNotificationCopy("contract_active", {})).toBeNull();
  });
  it("has plain failure messages", () => {
    expect(bookingFailureMessage("taken")).toBe("That time was just taken. Please pick another.");
    expect(bookingFailureMessage("stale")).toMatch(/no longer/i);
  });
});

describe("bookingPaymentState", () => {
  const NOW = new Date("2027-03-01T10:00:00Z");
  const row = (o: Record<string, unknown>) => ({ side: "client", client_total: 10200, status: "confirmed", price: 10000, currency: "USD", pay_by: "2027-03-02T10:00:00Z", payment_status: null, refund_status: null, ...o });
  it.each([
    [{ price: null }, null],
    [{ status: "pending", pay_by: null }, "awaiting"],
    [{}, "due"],
    [{ pay_by: "2027-03-01T09:59:00Z" }, "overdue"],
    [{ payment_status: "pending" }, "due"],
    [{ payment_status: "failed" }, "due"],
    [{ payment_status: "succeeded" }, "paid"],
    [{ status: "cancelled", payment_status: "succeeded" }, "paid"],
    [{ status: "cancelled", payment_status: "refund_pending", refund_status: "pending" }, "refund_pending"],
    [{ status: "cancelled", payment_status: "refunded", refund_status: "succeeded" }, "refunded"],
    [{ status: "cancelled" }, null],
    [{ status: "declined", pay_by: null }, null],
  ])("%o -> %s", (o, kind) => {
    expect(bookingPaymentState(row(o), NOW)?.kind ?? null).toBe(kind);
  });
  it("labels with the amount", () => {
    expect(bookingPaymentState(row({ payment_status: "succeeded" }), NOW)?.text).toBe("Paid $102.00");
    expect(bookingPaymentState(row({ status: "pending", pay_by: null }), NOW)?.text).toBe("$102.00, paid after confirmation");
    expect(bookingPaymentState(row({ status: "cancelled", payment_status: "refunded", refund_status: "succeeded" }), NOW)?.text).toBe("Refunded $102.00");
  });
  it("shows the professional the price and what the client pays", () => {
    expect(bookingPaymentState(row({ side: "provider", payment_status: "succeeded" }), NOW)?.text).toBe("Paid $102.00 by the client (your price $100.00)");
  });
});

describe("booking price copy", () => {
  it("describes the price and the cancellation rule", () => {
    expect(bookingPriceLine({ price: 5000, currency: "USD" })).toBe("$50.00 per session, paid after the professional confirms.");
    expect(bookingPriceLine(null)).toBeNull();
  });
});

describe("paid booking notifications", () => {
  it("has neutral copy for a payment", () => {
    expect(bookingNotificationCopy("booking_paid", {})?.text).toBe("A booking was paid.");
  });
});

describe("bookingRefundRule", () => {
  it("states the cut-off and the professional's side", () => {
    expect(bookingRefundRule(24)).toBe("Cancel at least 24 hours before the start for a full refund; later cancellations are not refunded. If the professional cancels, you get a full refund.");
    expect(bookingRefundRule(1)).toContain("at least 1 hour before");
    expect(bookingRefundRule(0)).toBe("Cancel any time before the start for a full refund. If the professional cancels, you get a full refund.");
  });
  it("tells a client when cancelling now would not be refunded", () => {
    const now = new Date("2027-03-01T10:00:00Z");
    expect(clientCancelForfeits({ side: "client", payment_status: "succeeded", starts_at: "2027-03-02T09:59:00Z" }, 24, now)).toBe(true);
    expect(clientCancelForfeits({ side: "client", payment_status: "succeeded", starts_at: "2027-03-02T10:00:00Z" }, 24, now)).toBe(false);
    expect(clientCancelForfeits({ side: "provider", payment_status: "succeeded", starts_at: "2027-03-01T11:00:00Z" }, 24, now)).toBe(false);
    expect(clientCancelForfeits({ side: "client", payment_status: null, starts_at: "2027-03-01T11:00:00Z" }, 24, now)).toBe(false);
  });
});

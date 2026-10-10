import { describe, expect, it } from "vitest";
import { bookingFailureMessage, bookingNotificationCopy, bookingStatusLabel, groupSlotsByDay } from "./present";

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

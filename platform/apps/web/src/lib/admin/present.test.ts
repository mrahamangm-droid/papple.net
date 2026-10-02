import { describe, expect, it } from "vitest";
import { VERIFIED_COPY, describeAuditAction, formatSettingValue } from "./present";

describe("present", () => {
  it("states what verification means and what it does not", () => {
    expect(VERIFIED_COPY).toContain("Papple reviewed the evidence supplied");
    expect(VERIFIED_COPY).toMatch(/not a licen[cs]e/i);
  });
  it("formats setting values for humans", () => {
    expect(formatSettingValue("commission.client_bps", 250)).toBe("2.5%");
    expect(formatSettingValue("some.flag", true)).toBe("On");
    expect(formatSettingValue("some.flag", false)).toBe("Off");
    expect(formatSettingValue("payments.checkout_expiry_minutes", 60)).toBe("60 minutes");
    expect(formatSettingValue("ai.monthly_message_limits", { free: 20 })).toBe('{"free":20}');
  });
  it("names audit actions and falls back to the raw key", () => {
    expect(describeAuditAction("admin.org.status")).toBe("Organization status changed");
    expect(describeAuditAction("something.new")).toBe("something.new");
  });
});

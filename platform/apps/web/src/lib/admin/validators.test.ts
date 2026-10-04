import { describe, expect, it } from "vitest";
import { SETTINGS, flagInput, nextCursor, orgStatusInput, parseAuditFilters, parseSettingValue, planInput, roleInput, settingInput, verificationRequestInput, verificationReviewInput, credentialReviewInput, credentialRevokeInput } from "./validators";

const id = "11111111-1111-4111-8111-111111111111";
const reason = "A perfectly good reason";

describe("settings registry", () => {
  it.each([
    ["commission.client_bps", 0, 10000, -1, 10001],
    ["commission.professional_bps", 0, 10000, -1, 10001],
    ["payments.checkout_expiry_minutes", 30, 1440, 29, 1441],
  ])("%s accepts its bounds and rejects just outside", (key, lo, hi, below, above) => {
    const s = SETTINGS[key].schema;
    expect(s.safeParse(lo).success).toBe(true);
    expect(s.safeParse(hi).success).toBe(true);
    expect(s.safeParse(below).success).toBe(false);
    expect(s.safeParse(above).success).toBe(false);
    expect(s.safeParse(1.5).success).toBe(false);
  });
  it("does not offer a payments switch that nothing enforces", () => {
    expect("payments.enabled" in SETTINGS).toBe(false);
    expect(SETTINGS["ai.daily_request_cap"].schema.safeParse(2000).success).toBe(true);
    expect(SETTINGS["ai.daily_request_cap"].schema.safeParse(-1).success).toBe(false);
    expect(SETTINGS["billing.grace_days"].schema.safeParse(7).success).toBe(true);
    expect(SETTINGS["billing.grace_days"].schema.safeParse(31).success).toBe(false);
    expect(SETTINGS["billing.grace_days"].schema.safeParse(-1).success).toBe(false);
    expect(SETTINGS["ai.daily_request_cap"].schema.safeParse(1.5).success).toBe(false);
  });
});

describe("parseSettingValue", () => {
  it("parses numbers, booleans and objects, and refuses the wrong shape", () => {
    expect(parseSettingValue("commission.client_bps", "500")).toEqual({ ok: true, value: 500 });
    expect(parseSettingValue("commission.client_bps", "abc")).toEqual({ ok: false });
    expect(parseSettingValue("commission.client_bps", "10001")).toEqual({ ok: false });
    expect(parseSettingValue("payments.enabled", "true")).toEqual({ ok: false });
    expect(parseSettingValue("ai.monthly_message_limits", '{"free":20,"enterprise":null}')).toEqual({ ok: true, value: { free: 20, enterprise: null } });
    expect(parseSettingValue("ai.monthly_message_limits", "[1]")).toEqual({ ok: false });
    expect(parseSettingValue("no.such.key", "1")).toEqual({ ok: false });
  });
});

describe("inputs", () => {
  it("settingInput refuses unknown keys and checks reason bounds", () => {
    expect(settingInput.safeParse({ key: "no.such", value: 1, reason }).success).toBe(false);
    for (const [n, ok] of [[9, false], [10, true], [1000, true], [1001, false]] as const)
      expect(settingInput.safeParse({ key: "commission.client_bps", value: 200, reason: "x".repeat(n) }).success).toBe(ok);
  });
  it("settingInput validates the value against the registry", () => {
    expect(settingInput.safeParse({ key: "commission.client_bps", value: 10001, reason }).success).toBe(false);
  });
  it("flag, org status, role, plan and verification inputs", () => {
    expect(flagInput.safeParse({ key: "ai.assistant", enabled: true, reason }).success).toBe(true);
    expect(flagInput.safeParse({ key: "ai.assistant", enabled: "yes", reason }).success).toBe(false);
    expect(orgStatusInput.safeParse({ orgId: id, status: "suspended", reason }).success).toBe(true);
    expect(orgStatusInput.safeParse({ orgId: id, status: "closed", reason }).success).toBe(false);
    expect(roleInput.safeParse({ userId: id, role: "support", grant: false, reason }).success).toBe(true);
    expect(roleInput.safeParse({ userId: id, role: "owner", grant: true, reason }).success).toBe(false);
    expect(planInput.safeParse({ key: "free", name: "Free", priceCents: 0, active: true, limits: {}, features: {}, reason }).success).toBe(true);
    expect(planInput.safeParse({ key: "free", name: "Free", priceCents: -1, active: true, limits: {}, features: {}, reason }).success).toBe(false);
    expect(planInput.safeParse({ key: "free", name: "Free", priceCents: null, active: true, limits: [], features: {}, reason }).success).toBe(false);
    expect(verificationRequestInput.safeParse({ orgId: id, note: "Registered company number 123", url: "https://example.com/x" }).success).toBe(true);
    expect(verificationRequestInput.safeParse({ orgId: id, note: "Registered company number 123", url: "http://example.com/x" }).success).toBe(false);
    expect(verificationRequestInput.safeParse({ orgId: id, note: "Registered company number 123", url: "" }).success).toBe(true);
    expect(verificationReviewInput.safeParse({ requestId: id, decision: "approved", note: reason }).success).toBe(true);
    expect(verificationReviewInput.safeParse({ requestId: id, decision: "withdrawn", note: reason }).success).toBe(false);
  });
});

describe("audit filters and paging", () => {
  it("drops invalid values instead of throwing", () => {
    expect(parseAuditFilters({ actor: id, action: " dispute. ", outcome: "success", from: "2026-01-01", to: "2026-02-01", before: "42" })).toEqual({
      actor: id, action: "dispute.", outcome: "success", from: "2026-01-01", to: "2026-02-01", before: 42,
    });
    expect(parseAuditFilters({ actor: "nope", outcome: "weird", from: "31/12/2026", to: "x", before: "abc" })).toEqual({});
    expect(parseAuditFilters({ action: "a".repeat(200) })).toEqual({});
    expect(parseAuditFilters({ before: "-3" })).toEqual({});
  });
  it("nextCursor is the last id only when the page is full", () => {
    expect(nextCursor([{ id: 9 }, { id: 8 }], 2)).toBe(8);
    expect(nextCursor([{ id: 9 }], 2)).toBeNull();
    expect(nextCursor([], 2)).toBeNull();
  });
});

describe("credential console inputs", () => {
  it("need a credential id, a known decision and a reason of 10 to 1000 characters", () => {
    expect(credentialReviewInput.safeParse({ credentialId: id, version: 2, decision: "approved", note: reason }).success).toBe(true);
    expect(credentialReviewInput.safeParse({ credentialId: id, decision: "approved", note: reason }).success).toBe(false);
    expect(credentialReviewInput.safeParse({ credentialId: id, version: 0, decision: "approved", note: reason }).success).toBe(false);
    expect(credentialReviewInput.safeParse({ credentialId: id, version: 1, decision: "maybe", note: reason }).success).toBe(false);
    expect(credentialReviewInput.safeParse({ credentialId: id, version: 1, decision: "approved", note: "short" }).success).toBe(false);
    expect(credentialReviewInput.safeParse({ credentialId: "x", version: 1, decision: "approved", note: reason }).success).toBe(false);
    expect(credentialRevokeInput.safeParse({ credentialId: id, reason }).success).toBe(true);
    expect(credentialRevokeInput.safeParse({ credentialId: id, reason: "x".repeat(1001) }).success).toBe(false);
  });
});

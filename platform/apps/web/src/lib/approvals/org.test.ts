import { describe, expect, it } from "vitest";
import { pickOrg } from "./org";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const ms = [{ orgId: A, role: "admin" }, { orgId: B, role: "owner" }];

describe("pickOrg", () => {
  it("uses the requested organization when the user belongs to it", () => expect(pickOrg(ms, B)?.orgId).toBe(B));
  it("takes the first value of a repeated parameter", () => expect(pickOrg(ms, [B, A])?.orgId).toBe(B));
  it("falls back to the first membership for unknown or malformed ids", () => {
    expect(pickOrg(ms, "33333333-3333-4333-8333-333333333333")?.orgId).toBe(A);
    expect(pickOrg(ms, "not-a-uuid")?.orgId).toBe(A);
    expect(pickOrg(ms, undefined)?.orgId).toBe(A);
  });
  it("returns nothing without memberships", () => expect(pickOrg([], A)).toBeUndefined());
});

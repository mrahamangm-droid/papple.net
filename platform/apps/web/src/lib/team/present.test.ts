import { describe, expect, it } from "vitest";
import { assignableRoles, canChangeMember, canInvite, canRemoveMember, roleLabel, seatSummary, teamFailureMessage, type TeamFailure } from "./present";

describe("who may do what (mirrors the database; the database decides)", () => {
  it("only owners and admins invite", () => {
    expect(canInvite("owner")).toBe(true); expect(canInvite("admin")).toBe(true);
    expect(canInvite("member")).toBe(false); expect(canInvite("viewer")).toBe(false);
  });
  it("owners may invite admins, admins only members and viewers", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "member", "viewer"]);
    expect(assignableRoles("admin")).toEqual(["member", "viewer"]);
    expect(assignableRoles("member")).toEqual([]);
  });
  it("owners may change anyone's role including promoting an owner; admins only member and viewer among themselves", () => {
    expect(canChangeMember("owner", "admin", false)).toEqual(["owner", "admin", "member", "viewer"]);
    expect(canChangeMember("admin", "member", false)).toEqual(["member", "viewer"]);
    expect(canChangeMember("admin", "admin", false)).toEqual([]);
    expect(canChangeMember("admin", "owner", false)).toEqual([]);
    expect(canChangeMember("viewer", "member", false)).toEqual([]);
  });
  it("nobody removes themselves from the list (they leave instead); admins remove only members and viewers", () => {
    expect(canRemoveMember("owner", "admin", true)).toBe(false);
    expect(canRemoveMember("owner", "admin", false)).toBe(true);
    expect(canRemoveMember("admin", "viewer", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(false);
    expect(canRemoveMember("member", "viewer", false)).toBe(false);
  });
});

describe("wording", () => {
  it("labels roles and falls back safely", () => {
    expect(roleLabel("owner")).toBe("Owner"); expect(roleLabel("weird")).toBe("Unknown");
  });
  it("has a plain message for every failure and never echoes server text", () => {
    const codes: TeamFailure[] = ["forbidden", "invalid", "duplicate", "limit", "notready", "owner_required", "rate", "error"];
    for (const c of codes) expect(teamFailureMessage(c).length).toBeGreaterThan(10);
    expect(teamFailureMessage("owner_required")).toMatch(/at least one owner/i);
    expect(teamFailureMessage("duplicate")).toMatch(/already/i);
  });
  it("summarises seats with and without a limit", () => {
    expect(seatSummary({ members: 3, pending: 1, limit: 5 })).toBe("4 of 5 seats used (3 members, 1 pending invite)");
    expect(seatSummary({ members: 1, pending: 0, limit: null })).toBe("1 member, 0 pending invites. Your plan has no seat limit.");
    expect(seatSummary({ members: 5, pending: 2, limit: 5 })).toMatch(/seat limit reached/i);
  });
});

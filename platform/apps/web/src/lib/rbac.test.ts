import { describe, expect, it } from "vitest";
import { can, decideAccess, navFor, type AuthContext } from "./rbac";

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: "u1",
  memberships: [{ orgId: "o1", role: "member" }],
  platformRoles: [],
  persona: "client",
  ...over,
});

describe("can", () => {
  it("gives owner and admin org.manage and members.manage; member and viewer neither", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(can({ orgRole: role }, "org.manage")).toBe(true);
      expect(can({ orgRole: role }, "members.manage")).toBe(true);
    }
    for (const role of ["member", "viewer"] as const) {
      expect(can({ orgRole: role }, "org.manage")).toBe(false);
      expect(can({ orgRole: role }, "members.manage")).toBe(false);
      expect(can({ orgRole: role }, "org.read")).toBe(true);
    }
  });
  it("platform.admin only for the platform admin role, never from an org role", () => {
    expect(can({ platformRole: "admin" }, "platform.admin")).toBe(true);
    expect(can({ platformRole: "support" }, "platform.admin")).toBe(false);
    expect(can({ orgRole: "owner" }, "platform.admin")).toBe(false);
  });
  it("denies everything with no roles", () => {
    expect(can({}, "org.read")).toBe(false);
  });
});

describe("decideAccess", () => {
  it("returns unauthenticated when there is no user", () => {
    expect(decideAccess(null, "org.read")).toBe("unauthenticated");
  });
  it("does not let a persona substitute for permissions", () => {
    expect(decideAccess(ctx({ persona: "professional" }), "platform.admin")).toBe("forbidden");
  });
  it("checks the role in the requested org, not in another org", () => {
    const c = ctx({ memberships: [{ orgId: "o1", role: "owner" }, { orgId: "o2", role: "viewer" }] });
    expect(decideAccess(c, "org.manage", "o1")).toBe("allow");
    expect(decideAccess(c, "org.manage", "o2")).toBe("forbidden");
    expect(decideAccess(c, "org.manage", "o3")).toBe("forbidden");
  });
  it("allows a platform admin through platform.admin only with a second factor (aal2)", () => {
    expect(decideAccess(ctx({ platformRoles: ["admin"], aal: "aal2" }), "platform.admin")).toBe("allow");
  });
  it("sends a platform admin without aal2 to MFA instead of allowing access", () => {
    expect(decideAccess(ctx({ platformRoles: ["admin"], aal: "aal1" }), "platform.admin")).toBe("mfa_required");
    expect(decideAccess(ctx({ platformRoles: ["admin"] }), "platform.admin")).toBe("mfa_required");
  });
  it("does not leak the MFA step to non-admins: they are simply forbidden", () => {
    expect(decideAccess(ctx({ aal: "aal1" }), "platform.admin")).toBe("forbidden");
  });
  it("does not require MFA for ordinary org capabilities", () => {
    expect(decideAccess(ctx({ aal: "aal1", memberships: [{ orgId: "o1", role: "owner" }] }), "org.manage", "o1")).toBe("allow");
  });
});

describe("navFor", () => {
  it("shows the Admin link only to platform admins", () => {
    expect(navFor(ctx()).map((i) => i.href)).not.toContain("/admin");
    expect(navFor(ctx({ platformRoles: ["admin"] })).map((i) => i.href)).toContain("/admin");
  });
  it("shows Billing only to organization owners", () => {
    expect(navFor(ctx()).map((i) => i.href)).not.toContain("/settings/billing");
    expect(navFor(ctx({ memberships: [{ orgId: "o1", role: "admin" }] })).map((i) => i.href)).not.toContain("/settings/billing");
    expect(navFor(ctx({ memberships: [{ orgId: "o1", role: "owner" }] })).map((i) => i.href)).toContain("/settings/billing");
  });
  it("always includes the dashboard", () => {
    expect(navFor(ctx()).map((i) => i.href)).toContain("/dashboard");
  });
});

describe("files.write", () => {
  it("lets owner, admin and member upload; viewer cannot", () => {
    for (const role of ["owner", "admin", "member"] as const) expect(can({ orgRole: role }, "files.write")).toBe(true);
    expect(can({ orgRole: "viewer" }, "files.write")).toBe(false);
  });
});

describe("navFor marketplace links", () => {
  const hrefs = (c: AuthContext) => navFor(c).map((i) => i.href);
  it("gives every signed-in user explore, projects, messages and notifications", () => {
    expect(hrefs(ctx({ memberships: [] }))).toEqual(expect.arrayContaining(["/explore", "/projects", "/messages", "/notifications"]));
  });
  it("shows profile and services only to users with a membership, never by persona alone", () => {
    expect(hrefs(ctx({ memberships: [], persona: "professional" }))).not.toContain("/profile");
    expect(hrefs(ctx({ memberships: [], persona: "professional" }))).not.toContain("/services");
    expect(hrefs(ctx())).toEqual(expect.arrayContaining(["/profile", "/services"]));
  });
  it("shows contracts and payouts only to users who belong to an organization", () => {
    expect(hrefs(ctx({ memberships: [] }))).not.toContain("/contracts");
    expect(hrefs(ctx({ memberships: [] }))).not.toContain("/settings/payouts");
    expect(hrefs(ctx())).toEqual(expect.arrayContaining(["/contracts", "/settings/payouts"]));
  });
});

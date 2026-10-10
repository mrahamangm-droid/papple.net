import type { Persona } from "./onboarding";

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type PlatformRole = "admin" | "support";
export type Capability = "org.read" | "org.manage" | "members.manage" | "files.write" | "platform.admin";

const ORG_CAPS: Record<OrgRole, Capability[]> = {
  owner: ["org.read", "org.manage", "members.manage", "files.write"],
  admin: ["org.read", "org.manage", "members.manage", "files.write"],
  member: ["org.read", "files.write"],
  viewer: ["org.read"],
};

export function can(ctx: { orgRole?: OrgRole; platformRole?: PlatformRole }, cap: Capability): boolean {
  if (cap === "platform.admin") return ctx.platformRole === "admin";
  return !!ctx.orgRole && ORG_CAPS[ctx.orgRole].includes(cap);
}

export interface AuthContext {
  userId: string;
  memberships: { orgId: string; role: OrgRole }[];
  platformRoles: PlatformRole[];
  persona: Persona | null;
  /** Supabase authenticator assurance level of the current session. aal2 = a second factor was verified. */
  aal?: "aal1" | "aal2" | null;
}

export type Decision = "allow" | "unauthenticated" | "forbidden" | "mfa_required";

/** Pure authorization decision. Persona is deliberately ignored: only memberships and platform roles grant access. */
export function decideAccess(ctx: AuthContext | null, cap: Capability, orgId?: string): Decision {
  if (!ctx) return "unauthenticated";
  if (cap === "platform.admin") {
    if (!ctx.platformRoles.includes("admin")) return "forbidden";
    return ctx.aal === "aal2" ? "allow" : "mfa_required"; // platform admins must have verified a second factor
  }
  const m = orgId ? ctx.memberships.find((x) => x.orgId === orgId) : ctx.memberships[0];
  return m && can({ orgRole: m.role }, cap) ? "allow" : "forbidden";
}

export interface NavItem { href: string; label: string }

export function navFor(ctx: AuthContext): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/explore", label: "Explore" },
    { href: "/projects", label: "Projects" },
    { href: "/messages", label: "Messages" },
    { href: "/notifications", label: "Notifications" },
  ];
  // Provider tools follow membership (what the database will actually allow), never the persona label.
  if (ctx.memberships.length > 0) items.push({ href: "/profile", label: "My profile" }, { href: "/services", label: "My services" });
  if (ctx.memberships.length > 0) items.push({ href: "/contracts", label: "Contracts" }, { href: "/settings/payouts", label: "Payouts" });
  if (ctx.memberships.length > 0) items.push({ href: "/crm", label: "CRM" }, { href: "/talent", label: "Talent pools" }, { href: "/invitations", label: "Invitations" }, { href: "/settings/team", label: "Team" });
  if (ctx.memberships.some((m) => m.role === "owner" || m.role === "admin")) items.push({ href: "/approvals", label: "Approvals" }, { href: "/settings/invoicing", label: "Invoicing" }, { href: "/settings/credentials", label: "Credentials" }, { href: "/analytics", label: "Analytics" });
  if (ctx.memberships.some((m) => m.role === "owner")) items.push({ href: "/settings/billing", label: "Billing" }, { href: "/settings/api-keys", label: "API keys" });
  if (ctx.platformRoles.includes("admin")) items.push({ href: "/admin", label: "Admin" });
  return items;
}

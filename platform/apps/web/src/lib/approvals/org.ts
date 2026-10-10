import { isValidUuid } from "../marketplace/validators";

/** The organization a page acts for: the one named in ?org= if the user belongs to it, otherwise their first. */
export function pickOrg<M extends { orgId: string }>(memberships: M[], wanted: string | string[] | undefined): M | undefined {
  const w = (Array.isArray(wanted) ? wanted[0] : wanted) ?? "";
  return memberships.find((m) => m.orgId === w && isValidUuid(w)) ?? memberships[0];
}

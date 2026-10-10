import { isValidUuid } from "../marketplace/validators";

/** The organization a page acts for: the one named in ?org= if the user belongs to it, otherwise the first one
 *  matching `prefer` (for example one they manage), otherwise their first. */
export function pickOrg<M extends { orgId: string }>(memberships: M[], wanted: string | string[] | undefined, prefer?: (m: M) => boolean): M | undefined {
  const w = (Array.isArray(wanted) ? wanted[0] : wanted) ?? "";
  return memberships.find((m) => m.orgId === w && isValidUuid(w)) ?? (prefer && memberships.find(prefer)) ?? memberships[0];
}

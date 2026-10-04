export type CredentialFailure = "forbidden" | "invalid" | "limit" | "rate" | "error";
export const KINDS = ["licence", "degree", "certification", "membership", "award"] as const;
export type CredentialKind = (typeof KINDS)[number];

const KIND_LABEL: Record<CredentialKind, string> = { licence: "Licence", degree: "Degree", certification: "Certification", membership: "Membership", award: "Award" };
export const kindLabel = (k: string): string => KIND_LABEL[k as CredentialKind] ?? "Credential";

/** What a visitor sees. "Checked" means a Papple reviewer looked at evidence; it is never a certification. Anything unrecognised reads as self-declared. */
export const CHECKED_COPY = "Checked by PAPple means our team reviewed the evidence supplied for that credential. It is not a certification of the credential, the issuer or the person's fitness to practise. Self-declared credentials have not been checked.";
export const statusLabel = (s: string): string => (s === "checked" ? "Checked by PAPple" : s === "expired" ? "Expired" : "Self-declared");

/** What the owner sees, with what happens next. */
export function ownerStatusLabel(s: string): string {
  switch (s) {
    case "pending": return "Waiting for a PAPple reviewer.";
    case "checked": return "Checked by PAPple. Editing it will make it self-declared again.";
    case "rejected": return "Not checked. It is not shown on your public profile. Fix it and request a check again.";
    case "revoked": return "Revoked by PAPple after review. It is not shown on your public profile and cannot be restored by editing. You can delete it.";
    default: return "Self-declared. Add an evidence link or identifier to request a check.";
  }
}

const MESSAGES: Record<CredentialFailure, string> = {
  forbidden: "Only owners and admins of an organization with a public provider profile can manage its credentials.",
  invalid: "Some details are missing or not valid. Check the dates and that any evidence link starts with https://.",
  limit: "Your plan's credential limit is reached. Delete one you no longer need or upgrade your plan.",
  rate: "You are going a little fast. Wait a moment and try again.",
  error: "Something went wrong. Please try again.",
};
export const credentialFailureMessage = (code: CredentialFailure): string => MESSAGES[code] ?? MESSAGES.error;

# PAPple PGAN expert credentials (slice C1) — design

Status: owner chose credentials as the first PGAN/Enterprise slice (then talent pools, then analytics); API access later. Written spec accepted under the owner's standing delegation.

## Goal
Professionals and experts list their credentials (licences, degrees, certifications, memberships, awards). Papple staff can check the evidence for each one. Clients see which credentials were checked and which are only self-declared.

## Honest labelling (the rule that drives everything)
A credential is shown publicly as exactly one of: **Checked by PAPple** (staff reviewed the evidence supplied and approved), or **Self-declared** (nothing checked). "Checked" never means Papple certifies the credential, the issuer, or the person's fitness to practise; the public copy says so. Rejected credentials are never shown. A checked credential past its expiry date is shown as **Expired**, not hidden.

## Rules
- One provider profile's organization owns its credentials; only owners and admins edit them. Viewers and members cannot.
- Fields: kind (`licence`, `degree`, `certification`, `membership`, `award`), title (3-160), issuer (2-160), optional identifier (licence or certificate number, max 80, **never shown publicly**), optional issued and expiry dates (expiry after issue), optional evidence link (https, max 500, never public; staff see it as text).
- Credentials work for individuals and agencies alike; the organization must have a provider profile.
- **Editing resets trust.** Changing title, issuer, identifier, kind, dates or evidence link on a credential that is pending or checked returns it to self-declared. A checked credential cannot be silently swapped for another one.
- **Review.** The owner requests a check with a note (10-1000 chars) once a credential has evidence (a link or an identifier). Staff (platform admin with second factor, reason 10-1000 chars, audited) approve or reject; the organization is notified. One pending review per credential. A rejected credential can be edited and requested again. Staff can also revoke a checked credential with a reason; a revoked credential stays revoked (editing cannot restore it; the owner can only delete it). A review names the version of the credential the reviewer saw and is refused if the credential changed since. Staff cannot review or revoke credentials of an organization they belong to.
- **Limit.** `limits.credentials` per profile by plan (default 10 / 30 / 100 / unlimited on Enterprise), changed in the database like other `limits.*`; enforced under an advisory lock.
- **Public view.** `public_provider_credentials` exposes, for public active profiles of active organizations, only: profile slug, kind, title, issuer, issued and expiry dates, and a status of `checked`, `expired` or `declared`. No identifier, no evidence, no review text.
- The PGAN persona itself changes nothing here: access follows memberships and platform roles. The existing profile-level Verified badge is unchanged and independent.

## Data (migration 0036)
`provider_credentials`; RLS select for owner/admin of the org and platform staff, no direct writes. RPCs: `credential_save`, `credential_delete`, `credential_request_check`, `credential_review` (admin), `credential_revoke` (admin). Audit rows for request, review, revoke. Defaults (`limits.credentials`) inserted by the migration.

## App
`lib/credentials/*` (validators, service, present), actions, `/settings/credentials` for owners/admins, an admin queue at `/admin/credentials`, a credentials section on the public profile page with the honest copy, nav item "Credentials", route gates.

## Out of scope
File uploads of evidence (a link is used), automatic checks against issuer registries, credential-based search filters, expiry reminder emails, expert ratings beyond existing reviews.

## Review focus
Anyone but owner/admin changing credentials; a checked credential being edited and staying checked; the identifier or evidence leaking publicly; rejected or someone else's credentials appearing; staff review without second factor; limit under parallel saves; double review; checking a credential with no evidence; expired shown as checked; misleading public wording.

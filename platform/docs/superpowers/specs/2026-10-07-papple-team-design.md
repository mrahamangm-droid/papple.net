# PAPple team workspace (SaaS tools, slice B3) — design

Status: owner chose in chat on 2026-10-07: invite, roles and member management; invitations by link and by email; seat limits per plan. Written spec accepted under the owner's standing delegation.

## Goal
An organization's owner or admin invites people, controls what each can do, and removes them; invited people join only by their own consent, and plans limit how many seats an organization can use.

## What exists and what changes
Roles already exist (`owner`, `admin`, `member`, `viewer`) and gate every other feature. Today there is no way to add a person except a direct insert into `memberships`, which owners and admins are allowed to do by row-level policy for any user id (no consent, no seat limit, and admins can demote each other). This slice removes direct writes to `memberships` and routes every change through audited-by-rule functions.

## Rules
- **Invite needs the invitee's address.** The invite stores the lower-cased email, the role (`admin`, `member` or `viewer`; never `owner`), the SHA-256 of a random token, an expiry (7 days), who invited. The token itself is shown once to the inviter as a link and is never stored.
- **Accepting needs the matching confirmed account.** The invitee signs in (or signs up) and opens `/invite/<token>`; the database accepts only if the signed-in user's confirmed email equals the invited address. A forwarded link is useless to anyone else. All failure cases (unknown, expired, revoked, used, wrong account, suspended organization) answer the same way.
- **Who may do what.** Owners: invite any role, change any role (including promoting another owner, which is how ownership moves), remove anyone but themselves. Admins: invite and revoke `member` or `viewer`, change `member`/`viewer` roles among themselves, remove `member`/`viewer`. Members and viewers: read the team list and leave. Nobody changes their own role except an owner stepping down while another owner remains; the last owner can never be removed or demoted (existing guard).
- **Seats.** `limits.team_seats` (default 1, professional_plus 5, business 25, enterprise unlimited). Members plus pending invites must stay under it when inviting; accepting re-checks against members. Organizations already over the limit keep their members but cannot add more. A daily cap `limits.team_invites_per_day` (20) bounds invite churn and email use per organization.
- **Email invites** are optional (flag `team.email_invites`, default off, same Resend configuration as CRM email). The invite is created first; the email is best effort, so a failure never loses the link. One plain-text message, no tracking, saying who invited them, to which organization, with the link, and that it can be ignored.
- **Leaving.** Anyone may leave an organization; the last owner cannot.
- Plan changes and organization suspension: a suspended organization cannot invite or accept.

## Data (migration 0035)
- `org_invites(id, org_id, email, role, token_hash unique, invited_by, created_at, expires_at, accepted_by, accepted_at, revoked_at)`; one pending invite per `(org_id, email)`; select for the organization's owners and admins through a column grant that excludes `token_hash`; no direct writes.
- `memberships`: insert, update and delete are revoked from signed-in users and the three write policies are dropped.
- RPCs (definer, `search_path = public`): `team_members`, `team_seat_usage`, `team_create_invite`, `team_revoke_invite`, `team_invite_preview`, `team_accept_invite`, `team_set_role`, `team_remove_member`, `team_leave`. Error codes: 42501 not allowed (also every invalid-token case), 22023 invalid, 23505 duplicate (already a member or already invited), 54000 limit, P0001 last owner.
- Settings and flag inserted by the migration: `limits.team_seats`, `limits.team_invites_per_day`, flag `team.email_invites`.

## Server and UI
`lib/team/token.ts` (random token, hash), `lib/team/service.ts` (validated inputs, throttle `team` 30/min, fixed messages, optional invite email), actions, `/settings/team` (members with role and remove controls where allowed, pending invites with revoke, invite form with the one-time link, seat usage, leave button), `/invite/[token]` (confirm page, protected so signed-out users go to sign in and come back), nav "Team" for every member.

## Out of scope
Activity log, custom roles or per-feature permissions, bulk invite or CSV, SSO/SCIM, ownership transfer as one step (promote then step down instead), removing a user's work when they leave.

## Review focus
Anyone joining without the invited account; token guessing or probing difference between failure cases; privilege escalation (admin minting admins or touching owners, self-promotion); seat and daily limits under parallel invites and parallel accepts; direct membership writes still possible; the last owner leaving; a removed member's lingering access; invite email spam; link shown or logged anywhere after creation.

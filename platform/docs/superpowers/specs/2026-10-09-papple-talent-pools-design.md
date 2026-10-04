# PAPple talent pools — design (slice 2 of PGAN & Enterprise)

## Goal
A client, enterprise or agency organization can keep **private pools** of professionals it trusts, annotate them privately, and **invite a pool member to one of its open projects**. The invited professional is notified and can decline; they answer by sending a normal proposal through the existing flow.

## Understanding
- Said: "Enterprise talent pools (private pools of professionals/experts, tags, direct invitation to projects)."
- Assumed: any org type that can post projects (`client_company`, `enterprise`, `agency`) may use pools, with limits by plan (Enterprise unlimited). Providers never see which pools they are in, nor the notes.
- Success: an org builds a shortlist once, re-uses it across projects, and invites without spamming anyone.

## Non-goals (later)
Pool sharing between orgs, bulk invite, auto-matching, import from CRM, invitation expiry reminders, API access.

## Data (migration 0037)
- `talent_pools(id, org_id, name 2–60, description ≤300, created_by, created_at, updated_at)`; unique `(org_id, lower(name))`.
- `talent_pool_members(pool_id, profile_id, org_id, note ≤1000, tags text[] ≤10 × ≤30 chars, added_by, added_at)`, pk `(pool_id, profile_id)`.
- `project_invitations(id, project_id, org_id (inviter), profile_id, invited_by, message ≤1000, status sent|declined, created_at, responded_at)`; unique `(project_id, profile_id)`.
- RLS: pools and members readable only by members of the owning org (no direct writes). Invitations readable by the inviting org and by owner/admin/member of the invited profile's org. All writes via SECURITY DEFINER RPCs.
- Limits (platform settings, missing key = unlimited): `limits.talent_pools` {1/3/10/null}, `limits.pool_members` per pool {25/100/500/null}, `limits.project_invites_per_day` {5/25/100/null} (per org, rolling 24h).

## Rules
1. Only **active, public** profiles of **active** orgs can be added or invited. A profile that later turns private/hidden or whose org is suspended disappears from the pool view and cannot be invited; its rows are kept.
2. Pool members cannot be the org's own profile (an org cannot pool itself).
3. Roles: owner/admin/member can add, edit and remove members and invite; only owner/admin create, rename and delete pools.
4. An invitation requires: project belongs to the caller's org, project status `open`, profile is in at least one of the org's pools (no cold invites), no earlier invitation for that project/profile, daily cap not reached.
5. Inviting notifies the provider org (`project_invite`); the message is shown to them, the inviter's identity is the organization, not the user.
6. The provider can decline once (`sent` → `declined`); declining is final for that project. Sending a proposal is unaffected and is not blocked by a decline.
7. Closing/cancelling a project leaves invitations as history; they are hidden from the provider's inbox once the project is no longer open.
8. Audit rows: `pool.create/delete`, `project.invite`, `invite.decline`.

## Errors
42501 not allowed, 22023 invalid, 23505 duplicate (pool name, invitation), 54000 limit.

## Surfaces
- `/talent` (owner/admin/member of eligible orgs): pools list, create; `/talent/[id]`: members with note/tags editing, remove, invite-to-project form.
- Adding professionals: search public profiles by name or headline on the pool page (the public profile page stays signed-out-friendly and cacheable).
- `/invitations` for providers: received invitations, decline.
- Nav entries gated by rbac; e2e route gating.

## Honest-labelling and privacy
Pools and notes are private to the organization and never appear in public views. The invitation message is the only thing the professional sees.

## Tests
pgTAP (isolation, limits, eligibility, state changes, notifications, audit), race tests (pool member limit, daily invite cap, duplicate invite), vitest for validators/service/presenters, e2e route gating.

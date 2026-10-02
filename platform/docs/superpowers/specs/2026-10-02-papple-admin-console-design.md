# PAPple Sub-project 4b: Admin console, first slice

Status: draft for review. Builds on sub-project 4 (disputes and refunds, PR #23). Roadmap item 4 is delivered in two slices; this is slice 1. Slice 2 (content moderation, taxonomy editing) is out of scope here.

## Goal

A platform Admin can operate the marketplace without editing the database: change fees and limits, manage plans and feature flags, read the audit log, suspend organizations, manage staff roles, and review provider verification requests.

## Decisions carried in

- Admin only (`platform_roles.role = 'admin'`); `support` has no write access in this slice and cannot read the audit log (its existing RLS is admin-only).
- Every write goes through a SECURITY DEFINER function that checks admin and aal2 in the database, AND through `createAdminAction` plus an aal2 check in the server action (the review of sub-project 4 showed the action layer must not rely on the database alone when it calls out of band).
- Every write needs a reason of 10 to 1,000 characters and writes an `audit_log` row.
- Verification badge means "Papple reviewed the evidence the professional supplied". It does not certify a licence or credential, and the badge copy says so.
- Out of scope: identity-document upload (a request holds a note and an https link only), bulk actions, email notifications, support-role permissions, moderation, taxonomy.

## 1. Settings, fees and plans

- **Registry** (`lib/admin/settings-registry.ts`): the editable keys with label, unit, zod schema and a `risky` flag. Initial keys are those seeded today: `commission.professional_bps` and `commission.client_bps` (integer 0 to 10,000), `payments.enabled` (boolean, risky), `payments.min_application_fee_minor`, `contracts.min_milestone_minor`, `payments.checkout_expiry_minutes` (30 to 1,440), `reviews.reveal_after_days`, `contracts.max_milestones`, `limits.max_orgs_per_user`, `ai.monthly_message_limits` (object of non-negative integers or null per plan key). Keys not in the registry cannot be edited.
- `admin_set_setting(p_key text, p_value jsonb, p_reason text) returns void`: the key must already exist in `platform_settings` (no creating keys), the existing history trigger records old and new values and the actor, and an audit row stores the reason. The database does not know the registry's ranges; it checks only JSON shape sanity (`jsonb_typeof` unchanged from the stored value), and the server validates ranges. A direct call with a wrong-typed value is refused.
- Fee screen shows: "New fees apply to contracts hired after this change; existing contracts keep their snapshot." Risky keys need a confirm dialog.
- `admin_set_flag(p_key text, p_enabled boolean, p_reason text)`: global toggle of an existing flag. Per-organization overrides are not edited here.
- `admin_update_plan(p_key text, p_name text, p_price_cents int, p_active boolean, p_limits jsonb, p_features jsonb, p_reason text)`: `stripe_price_id`, `audience`, `interval` and `currency` are not editable here; plans cannot be created or deleted. `limits` and `features` must be JSON objects.

## 2. Audit log viewer

`/admin/audit`: read through the user's session (RLS already admits admins only). Filters: actor id, action (prefix match), outcome, from and to date. Newest first, keyset pagination on `id` (50 per page). Payloads are shown as stored (already redacted at write time). Read-only; no export in this slice.

## 3. Organizations, roles and verification

- **Suspend and restore:** `admin_set_org_status(p_org uuid, p_status text, p_reason text)` toggles `organizations.status` between `active` and `suspended` only (`pending_verification` is untouched). Effect: public views already require `status = 'active'`, so a suspended organization disappears from public pages. In addition `is_member` and `has_org_role` treat a suspended organization as no membership, so its members lose organization-scoped reads and writes everywhere those helpers are used. Platform staff are unaffected and webhooks use the service role, so a payment already in flight still completes. Counterparties of a suspended organization are unaffected.
- **Staff roles:** `admin_set_platform_role(p_user uuid, p_role text, p_grant boolean, p_reason text)`. Refused: changing your own role, and revoking the last remaining `admin`.
- **Verification (new):**
  - `provider_profiles.verified_at timestamptz` (null by default). Owners cannot write it (column grants unchanged; the upsert function does not touch it).
  - Table `verification_requests`: `id`, `org_id`, `status` (`pending`, `approved`, `rejected`, `withdrawn`), `evidence_note` (10 to 1,000), `evidence_url` (https only, up to 500, optional), `reviewed_by`, `review_note`, `created_at`, `reviewed_at`. One pending request per organization (partial unique index). Visible to the organization's owners and admins and to platform staff.
  - `request_verification(p_org, p_note, p_url)`: org owner or admin, a provider profile must exist, no pending request, not already verified.
  - `review_verification(p_request, p_decision text, p_note text)`: admin and aal2; `approved` sets `verified_at`, both outcomes notify the organization and write audit.
  - `revoke_verification(p_org, p_reason)`: admin and aal2; clears `verified_at`.
  - `public_provider_cards` gains a `verified boolean` column (appended) and cards show a "Verified" badge with the copy above.

## Screens

`/admin` links to: `/admin/settings` (settings and flags), `/admin/plans`, `/admin/audit`, `/admin/organizations` (list, suspend, restore), `/admin/staff` (roles), `/admin/verification` (queue and revoke). Professionals request verification at `/settings/verification`.

## Testing

- pgTAP: each function for anonymous, member, support, admin without aal2, admin with aal2; settings type-shape refusal and unknown-key refusal; last-admin and self-change guards; suspension effect on `is_member`, `has_org_role` and the public views; verification state machine and column grant; the cards view still public-safe.
- Unit: registry schemas (boundaries), validators, presenters (queue ordering, filter parsing), server actions with fakes (aal2 refused before any call, error mapping), keyset pagination helper.
- e2e anonymous: every new admin route redirects to sign-in.
- NOT VERIFIED until an admin account with MFA is used in a browser: the screens themselves.

## Review focus

- Suspending an organization that is party to a live contract with a payment in flight.
- The `is_member` change: any RLS policy or RPC that would now lock out platform staff or break counterparties.
- Editing `payments.enabled` or the commission while a checkout is open.
- Revoking the last admin through two concurrent requests.
- A verification approved for an organization whose profile was hidden or deleted.

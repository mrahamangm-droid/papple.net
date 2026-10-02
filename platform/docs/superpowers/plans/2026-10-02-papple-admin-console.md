# PAPple Admin Console (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can edit settings, flags and plans, read the audit log, suspend organizations, manage staff roles and review provider verification, all audited and aal2-gated.

**Architecture:** Same layering as sub-project 4: SECURITY DEFINER functions are the authority (admin + aal2 + reason), a testable `createAdminConsoleActions` factory holds the server logic behind `adminAction`, a settings registry holds the types and ranges the database does not know, and screens read through the user's session so RLS applies.

**Tech Stack:** Postgres/Supabase (pgTAP), Next.js server actions, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-papple-admin-console-design.md`

## Global Constraints

- Admin only (`is_platform_admin()`), `coalesce(auth.jwt() ->> 'aal','aal1') = 'aal2'`, errcodes 42501 (not allowed or no second factor) and 22023 (invalid input or state), reason 10 to 1,000 characters on every write.
- Every write inserts an `audit_log` row (`actor_id`, `action`, `entity`, `entity_id`, `before`, `after`, `outcome 'success'`, `request_id gen_random_uuid()::text`).
- Server actions: `createAdminAction` plus an aal2 check (`hasSecondFactor`) before any call. Expected failures return codes, never throw.
- Migrations 0022 to 0024, pgTAP 022 to 024. Existing suites (vitest 427, pgTAP 461, race tests) stay green.
- New tables get RLS, `revoke all` from anon/public/authenticated, narrow grants; `scripts/check-rls-coverage.sql` must stay clean.

## Review Focus

- Suspending an organization that is party to a live contract with a payment in flight: the webhook (service role) must still record it; counterparty keeps access.
- The `is_member`/`has_org_role` change must not lock out platform staff or break counterparty reads (`is_contract_party`, messaging).
- Editing `payments.enabled` or commission while a checkout is open must not change an existing contract (snapshot).
- Two concurrent revocations of the last two admins: exactly one succeeds.
- Approving verification for an organization whose provider profile is hidden or missing: refused, no badge on a hidden profile.

---

### Task 1: Settings, flags and plans functions (migration 0022)

**Files:** Create `supabase/migrations/0022_admin_config.sql`, `supabase/tests/022_admin_config.test.sql`.

**Interfaces:** Produces `admin_set_setting(p_key text, p_value jsonb, p_reason text) returns void`, `admin_set_flag(p_key text, p_enabled boolean, p_reason text) returns void`, `admin_update_plan(p_key text, p_name text, p_price_cents int, p_active boolean, p_limits jsonb, p_features jsonb, p_reason text) returns void`; all execute for `authenticated` (they check admin and aal2 inside).

- [ ] **Step 1:** Write the pgTAP test: for each function, anonymous/user/support/admin-without-aal2 get 42501; admin with aal2 succeeds; short reason gets 22023; `admin_set_setting` on an unknown key gets 22023 and on a value whose `jsonb_typeof` differs from the stored one (e.g. text for `commission.client_bps`) gets 22023; a successful change writes one `settings_history` row with old and new values and the acting user, and one `audit_log` row containing the reason; `admin_update_plan` refuses `p_limits` that is not a JSON object and a negative price, changes only the listed columns (`stripe_price_id`, `audience`, `interval`, `currency` unchanged), and never creates or deletes a plan; `admin_set_flag` on an unknown flag gets 22023.
- [ ] **Step 2:** Run `bash scripts/db-test.sh`. Expected: 022 FAILS (functions missing).
- [ ] **Step 3:** Implement the three functions (SECURITY DEFINER, `set search_path = public`), grant execute to `authenticated`, revoke from `public`, `anon`.
- [ ] **Step 4:** Run `bash scripts/db-test.sh`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): admin settings, flags and plans`.

### Task 2: Suspension and staff roles (migration 0023)

**Files:** Create `supabase/migrations/0023_admin_orgs_roles.sql`, `supabase/tests/023_admin_orgs_roles.test.sql`.

**Interfaces:** Produces `admin_set_org_status(p_org uuid, p_status text, p_reason text) returns void` (status `active` or `suspended` only), `admin_set_platform_role(p_user uuid, p_role text, p_grant boolean, p_reason text) returns void`; replaces `is_member(uuid)` and `has_org_role(uuid, text[])` so a membership in an organization whose `status = 'suspended'` does not count; adds RLS policy `platform_roles_select_admin` (admins read every row).

- [ ] **Step 1:** Write the test: access matrix as Task 1; status other than `active`/`suspended` or an organization in `pending_verification` gets 22023; suspending removes the org from `public_provider_cards`; a member of a suspended org gets `is_member` false and `has_org_role` false and cannot read the org's contracts or write a proposal, while the counterparty still reads the shared contract and platform staff still read everything; restore reverses it; `record_payment_succeeded` still records a payment for a suspended provider (service role); grant and revoke roles, refuse changing your own role, refuse revoking the last `admin` (22023), allow it when another admin exists, refuse unknown role; admins can read all `platform_roles`, a normal user only their own.
- [ ] **Step 2:** Run the suite. Expected: 023 FAILS.
- [ ] **Step 3:** Implement; lock the `platform_roles` rows `for update` before the last-admin count so two concurrent revocations serialize.
- [ ] **Step 4:** Run the suite plus `bash scripts/db-race-test.sh`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): suspend organizations and manage staff roles`.

### Task 3: Provider verification (migration 0024)

**Files:** Create `supabase/migrations/0024_verification.sql`, `supabase/tests/024_verification.test.sql`.

**Interfaces:** Produces column `provider_profiles.verified_at timestamptz`; table `verification_requests` (columns per spec; partial unique index one `pending` per org); `request_verification(p_org uuid, p_note text, p_url text) returns uuid`, `review_verification(p_request uuid, p_decision text, p_note text) returns void` (`approved`|`rejected`), `revoke_verification(p_org uuid, p_reason text) returns void`; `public_provider_cards` gains appended column `verified boolean`.

- [ ] **Step 1:** Write the test: owner/admin of the org can request, member/viewer/stranger cannot (42501); no provider profile, a pending request, or already verified gives 22023; note under 10 chars or non-https url gives 22023; review needs admin + aal2, only a pending request can be reviewed, approve sets `verified_at` and notifies the org, reject leaves it null and notifies; approving when the profile is `hidden_by_admin` is refused (22023); revoke clears `verified_at`; owners cannot update `verified_at` directly; requests visible to the org's owners/admins and staff only; `public_provider_cards.verified` is true only after approval and the view still exposes no org ids.
- [ ] **Step 2:** Run the suite. Expected: 024 FAILS.
- [ ] **Step 3:** Implement with RLS and column grants; `create or replace view` appending `verified`.
- [ ] **Step 4:** Run the suite. Expected: all pass, RLS coverage OK.
- [ ] **Step 5:** Commit `feat(db): provider verification`.

### Task 4: Registry, validators and presenters

**Files:** Create `apps/web/src/lib/admin/settings-registry.ts`, `validators.ts`, `present.ts` and matching `.test.ts` files.

**Interfaces:** Produces `SETTINGS: Record<string, { label: string; unit: string; schema: ZodType; risky: boolean }>`, `settingInput` = `{ key (must be in SETTINGS), value: unknown, reason: string 10..1000 }` with `parseSettingValue(key, raw: string): { ok: true; value: unknown } | { ok: false }` (numbers, booleans, JSON objects); `flagInput`, `planInput`, `orgStatusInput`, `roleInput`, `verificationRequestInput`, `verificationReviewInput`; `parseAuditFilters(searchParams): { actor?: string; action?: string; outcome?: 'success'|'denied'|'invalid'|'error'; from?: string; to?: string; before?: number }` (invalid values dropped, never thrown); `nextCursor(rows: {id: number}[], pageSize: number): number | null`.

- [ ] **Step 1:** Write tests: every registry key accepts its boundary values and rejects just outside (bps -1 and 10001, expiry 29 and 1441); `parseSettingValue` rejects `"abc"` for a number and accepts `"500"`, `"true"`, and a JSON object for `ai.monthly_message_limits`; unknown key rejected by `settingInput`; reason boundaries 9, 10, 1000, 1001; `parseAuditFilters` drops a bad date, bad outcome, non-numeric cursor and trims the action; `nextCursor` returns the last id only when the page is full.
- [ ] **Step 2:** Run `cd apps/web && npx vitest run src/lib/admin`. Expected: FAIL.
- [ ] **Step 3:** Implement the files.
- [ ] **Step 4:** Run vitest for the folder. Expected: PASS.
- [ ] **Step 5:** Commit `feat(admin): settings registry, validators and presenters`.

### Task 5: Admin console actions

**Files:** Create `apps/web/src/lib/admin/db.ts`, `actions.ts`, `actions.test.ts`; Modify `apps/web/src/lib/server.ts` (export `adminConsoleDb`).

**Interfaces:** Consumes Task 4 validators and Tasks 1 to 3 functions. Produces `createAdminConsoleDb(rpc)` with `setSetting`, `setFlag`, `updatePlan`, `setOrgStatus`, `setPlatformRole`, `requestVerification`, `reviewVerification`, `revokeVerification` (each maps database errors with `mapDbError`); `createAdminConsoleActions({ db, revalidate, hasSecondFactor })` returning methods of the same names that return `{ ok: true } | { ok: false; code: "forbidden"|"invalid"|"error" }`, validating input with the Task 4 schemas, refusing without a second factor before any database call, and validating a setting value against the registry before calling `setSetting`.

- [ ] **Step 1:** Write `actions.test.ts` with fakes: each method rejects bad input without calling the database; without `hasSecondFactor` returns forbidden and never calls the database; a registry violation (bps 10001) returns invalid and never calls the database; database `NotAllowedError`/`InvalidInputError` map to forbidden/invalid; success revalidates the right path; `requestVerification` does not require aal2 (it is a professional action) but needs `hasSession`-style auth through the existing contract-actions pattern.
- [ ] **Step 2:** Run vitest for the folder. Expected: FAIL.
- [ ] **Step 3:** Implement. `requestVerification` is the only method that skips the aal2 and admin wrapper; it is exposed through a plain authenticated action.
- [ ] **Step 4:** Run vitest and `npx tsc --noEmit`. Expected: pass, clean.
- [ ] **Step 5:** Commit `feat(admin): console server actions`.

### Task 6: Screens and wiring

**Files:** Create under `apps/web/src/app/(app)/admin/`: `settings/page.tsx`, `plans/page.tsx`, `audit/page.tsx`, `organizations/page.tsx`, `staff/page.tsx`, `verification/page.tsx`, `actions.ts` (server actions wrapped with `adminAction` and `hasSecondFactor`, one exported async function each); `apps/web/src/app/(app)/settings/verification/page.tsx` and `verification-actions.ts`; client forms under `apps/web/src/components/admin/`; Modify `apps/web/src/app/(app)/admin/page.tsx` (links), the public provider card component (Verified badge and copy), `apps/web/e2e/contracts-anonymous.spec.ts`.

**Interfaces:** Consumes Task 5. Screens read through `createServerSupabase()` (RLS). The audit page uses `parseAuditFilters` and `nextCursor`.

- [ ] **Step 1:** Add anonymous e2e cases for every new route (`/admin/settings`, `/admin/plans`, `/admin/audit`, `/admin/organizations`, `/admin/staff`, `/admin/verification`, `/settings/verification`) expecting a 307 to `/signin?next=...`; add a presenter test for the badge copy ("Papple reviewed the evidence supplied; this is not a licence or credential check").
- [ ] **Step 2:** Run `cd apps/web && npx vitest run && npx tsc --noEmit`. Expected: new tests FAIL before the pages exist.
- [ ] **Step 3:** Implement screens, forms (confirm dialog for risky settings and suspensions, fee note "applies to contracts hired after this change"), actions and the badge.
- [ ] **Step 4:** Run vitest, `tsc`, `npx eslint src`, `npx next build`, and `npx playwright test e2e/contracts-anonymous.spec.ts`. Expected: all green.
- [ ] **Step 5:** Commit `feat(admin): console screens and verification badge`.

### Task 7: Docs and acceptance

**Files:** Modify `docs/architecture.md`, `README.md`; Create `docs/acceptance-subproject-4b.md`.

- [ ] **Step 1:** Document the registry, the suspension effect on `is_member`/`has_org_role`, the verification meaning, and an acceptance table with NOT VERIFIED rows (screens signed in with MFA, a real suspension in production, badge on live pages).
- [ ] **Step 2:** Run the whole evidence set: `bash scripts/db-test.sh`, `bash scripts/db-race-test.sh`, vitest, tsc, eslint, build, anonymous Playwright. Expected: all green.
- [ ] **Step 3:** Commit `docs: SP4b acceptance and architecture`.

# PAPple Contracts, Milestone Payments, Reviews, Disputes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, inline). Steps use checkbox syntax.

**Goal:** Turn a shortlisted proposal into a contract with milestones, pay each milestone through Stripe destination charges on client approval, then support reviews and disputes, without Papple holding funds.

**Architecture:** Same patterns as marketplace-core. Postgres tables with RLS default-deny; every write is a SECURITY DEFINER RPC taking an explicit `p_org` and re-checking the role (errcodes 42501/22023/54000/23505). Money-moving state changes that only Stripe may cause (`record_payment_succeeded`, `upsert_connected_account`) are executable by `service_role` only. All Stripe access sits behind a `PaymentProvider` interface with a fake for tests. Web code is dependency-injected factories wrapped by thin Next route/action files.

**Tech Stack:** Postgres 16 + pgTAP (local harness `scripts/db-test.sh`, `scripts/db-race-test.sh`), Next 16, Vitest (node, `*.test.ts` only), zod, `stripe` npm package behind the interface.

**Spec:** `docs/superpowers/specs/2026-10-02-papple-contracts-payments-design.md`

## Global Constraints

- Money is integer minor units; currency exponent from Intl (USD 2, JPY 0, KWD 3). Use `applyBps`/`splitCommission` in `apps/web/src/lib/money.ts` (half-up).
- Commission rates and limits come from `platform_settings`, never constants. Rates are snapshotted onto the contract at hire.
- Only the verified Stripe webhook may mark a payment succeeded. The browser redirect never does.
- Papple stores Stripe ids and statuses only; the Stripe account id is never exposed to the other party.
- Errors shown to users are generic (reuse `mapDbError`); database text never reaches the UI.
- Migrations are numbered `0015`+; every new table passes `scripts/check-rls-coverage.sql`.
- Next 16 differs from older versions: read `apps/web/node_modules/next/dist/docs/` before writing route/page code. Server pages use `PageProps` types after `npx next typegen`.
- Commits end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jS6LRnfRga5pXV6Wwm9sW`.

## Review Focus

Failure modes the spec implies that no single task's happy path covers; each has a pinning test in the owning task.

1. A client who is also a member of the provider org must not be able to hire or approve their own work (self-deal). Task 3.
2. Approving the same milestone twice, concurrently or by retry, yields exactly one payment row and one Checkout session reuse. Tasks 4 and 10.
3. A webhook replayed, delivered out of order (`account.updated` after payment), or with a bad signature changes nothing or is rejected. Task 6.
4. Milestone amounts that do not sum to the contract price, or a currency different from the proposal's, can never activate a contract. Task 3.
5. A dispute raised while a Checkout session is open must stop the payment from being recorded as a normal completion path: the payment is still recorded (money moved) but the milestone state does not advance a disputed contract silently. Task 5.

---

### Task 1: Charge math

**Files:** Modify `apps/web/src/lib/money.ts`; Test `apps/web/src/lib/money.test.ts`.

**Interfaces:**
- Produces: `computeMilestoneCharge(amountMinor: number, professionalBps: number, clientBps: number, minFeeMinor: number): { amountMinor; clientFeeMinor; professionalFeeMinor; clientTotalMinor; applicationFeeMinor; professionalNetMinor }`.

- [ ] **Step 1: Failing tests** in `money.test.ts`: (a) 100000 at 500/200 bps, floor 0 → clientFee 2000, professionalFee 5000, clientTotal 102000, applicationFee 7000, net 95000; (b) invariant `clientTotal - applicationFee + professionalFee === amount`... i.e. `professionalNet === clientTotal - applicationFee` for 1000 random amounts; (c) floor: amount 100 with floor 50 gives applicationFee 50 and net `clientTotal - 50`, never negative; (d) zero-exponent amount 1 (JPY) with bps 500/200 rounds half-up without throwing; (e) rejects non-integer and negative input with RangeError.
- [ ] **Step 2:** Run `cd apps/web && npx vitest run src/lib/money.test.ts`. Expected: FAIL, `computeMilestoneCharge` not exported.
- [ ] **Step 3:** Implement. `applicationFee = max(clientFee + professionalFee, minFee)`, capped so `professionalNet >= 0` (cap at `clientTotal`). `professionalNet = clientTotal - applicationFee`.
- [ ] **Step 4:** Run the file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(money): milestone charge computation`.

### Task 2: Schema — settings, connected accounts, contracts, milestones

**Files:** Create `supabase/migrations/0015_contracts.sql`, `supabase/tests/015_contracts.test.sql`; Modify `supabase/seed.sql`.

**Interfaces:**
- Produces tables per spec section 4: `connected_accounts`, `contracts`, `milestones` (payments, reviews, disputes come in Tasks 4–5). Produces helper `public.is_contract_party(p_contract uuid) returns boolean` (member of client or provider org, SECURITY DEFINER stable). Alters `proposals.status` check to add `'hired'`. Seeds `payments.min_application_fee_minor=50`, `reviews.reveal_after_days=14`, `contracts.max_milestones=20`, `payments.checkout_expiry_minutes=60` (marked placeholders in description).

- [ ] **Step 1: Failing pgTAP test** `015`: tables exist with RLS on; anonymous sees nothing; stranger sees nothing; client-org and provider-org members and platform admin can select a contract; other org cannot; `milestones` unique `(contract_id, position)`; `connected_accounts.stripe_account_id` is not selectable by the client org (column grant) and is selectable by the owning org owner/admin; direct insert/update/delete by `authenticated` denied on all three tables; proposals accept `'hired'`.
- [ ] **Step 2:** Run `bash scripts/db-test.sh`. Expected: FAIL at 015 (tables missing).
- [ ] **Step 3:** Write migration: tables, `touch_updated_at` triggers, RLS with the policies above, column-level grants (no `stripe_account_id` for contract-party reads), seeds. Contract columns as spec plus `accepted_by_client`/`accepted_by_provider` booleans and `cancelled_reason text`.
- [ ] **Step 4:** Run `bash scripts/db-test.sh`. Expected: all pass, RLS coverage OK.
- [ ] **Step 5:** Commit `feat(db): contracts, milestones, connected accounts`.

### Task 3: Contract RPCs

**Files:** Create `supabase/migrations/0016_contract_rpcs.sql`, `supabase/tests/016_contract_rpcs.test.sql`.

**Interfaces:**
- Produces (all `authenticated`, security definer, fixed search_path):
  - `create_contract(p_org uuid, p_proposal uuid) returns uuid` — caller owner/admin of the project's client org `p_org`; proposal `shortlisted`; project `open`; caller NOT a member of the proposal's provider org (self-deal, 42501); locks `contract:<proposal>`; snapshots price, currency and commission bps from settings; proposal → `hired`; project → `closed`; contract `draft`.
  - `set_milestones(p_org uuid, p_contract uuid, p_items jsonb) returns void` — either party org while `draft`; replaces the list; each item `{title, description, amount, due_date}`; count ≤ `contracts.max_milestones`; resets both acceptances.
  - `accept_contract(p_org uuid, p_contract uuid) returns void` — records that org's acceptance (idempotent).
  - `activate_contract(p_contract uuid) returns void` — requires both accepted, sum(amount) = price, ≥1 milestone, provider `connected_accounts.payouts_enabled`; else 22023. Sets `active`.
  - `submit_milestone(p_org uuid, p_milestone uuid)` provider org, milestone `pending|changes_requested`, contract `active`.
  - `request_changes(p_org uuid, p_milestone uuid, p_note text)` client org, milestone `submitted`.
  - `cancel_contract(p_org uuid, p_contract uuid, p_reason text)` either party while `draft`; client or provider while `active` only if no milestone is `approved|paid`... simplified rule: only `draft` can be cancelled here; active contracts end by completion or dispute.
  - `approve_milestone` is Task 4.

- [ ] **Step 1: Failing pgTAP test** `016` covering: happy path hire→milestones→both accept→activate; stranger and other-org member rejected on every RPC (42501); member of both orgs cannot hire (Review Focus 1); proposal not shortlisted rejected (22023); second `create_contract` on the same proposal fails (23505); sum mismatch rejected; currency is the proposal's; no payouts-enabled account rejected; milestone count over max rejected (54000); commission snapshot equals settings at hire and does not change after the setting changes; provider cannot `request_changes`; client cannot `submit_milestone`.
- [ ] **Step 2:** Run `bash scripts/db-test.sh`. Expected: FAIL (functions missing).
- [ ] **Step 3:** Implement the RPCs. Use `has_org_role(org, array['owner','admin'])` for hire/accept/activate and `array['owner','admin','member']` for milestone actions. Notify the other party via `notify_org` on offer, submission, and change request.
- [ ] **Step 4:** Run `bash scripts/db-test.sh`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): contract and milestone RPCs`.

### Task 4: Payments schema and RPCs

**Files:** Create `supabase/migrations/0017_payments.sql`, `supabase/tests/017_payments.test.sql`.

**Interfaces:**
- Produces table `payments` (spec section 4, unique `milestone_id`, readable by contract parties, no client writes).
- `approve_milestone(p_org uuid, p_milestone uuid) returns jsonb` — client org owner/admin; milestone `submitted` (or already `approved` with non-succeeded payment, for retry); contract `active` and no open dispute; locks `milestone:<id>`; upserts the single payments row `pending` with amounts from the contract snapshot and settings floor; returns `{payment_id, amount, client_fee, provider_fee, client_total, application_fee, currency, provider_account}`. The returned `provider_account` is only for the server caller, so this RPC is `service_role`-callable through a wrapper: `approve_milestone` itself is `authenticated` and returns everything except the account id; `payment_destination(p_payment uuid)` is `service_role` only and returns the Stripe account id.
- `attach_checkout_session(p_payment uuid, p_session text)` service_role only.
- `record_payment_succeeded(p_session text, p_intent text)` service_role only; idempotent; sets payment `succeeded`, milestone `paid`; if all milestones paid and contract `active`, sets contract `completed` and notifies both orgs; if contract is `disputed` the payment is still recorded and the milestone `paid` but the contract stays `disputed`.
- `record_payment_failed(p_session text)` service_role only; payment `failed`, milestone stays `approved` so approve can retry.
- `upsert_connected_account(p_org uuid, p_account text, p_payouts boolean, p_details boolean)` service_role only.

- [ ] **Step 1: Failing pgTAP test** `017`: approve by client creates exactly one pending payment with exact fee numbers; calling twice returns the same payment id (idempotent); provider and stranger cannot approve; approve on a `pending` milestone, a disputed contract, or a completed one is rejected; `authenticated` cannot execute service-role RPCs (privilege check on each); `record_payment_succeeded` twice leaves one succeeded payment and milestone `paid`; paying the last milestone completes the contract; failure leaves milestone `approved` and a retry reuses the row; the client org cannot read `stripe_account_id`.
- [ ] **Step 2:** Run `bash scripts/db-test.sh`. Expected: FAIL.
- [ ] **Step 3:** Implement. Check `scripts/local-shim.sql` for a `service_role` role; add it to the shim if missing so grants can be tested.
- [ ] **Step 4:** Run `bash scripts/db-test.sh`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): milestone approval and payment recording`.

### Task 5: Disputes, reviews, ratings view

**Files:** Create `supabase/migrations/0018_disputes_reviews.sql`, `supabase/tests/018_disputes_reviews.test.sql`.

**Interfaces:**
- Tables `disputes`, `reviews`; view `public_provider_ratings(org_id, rating_avg, rating_count)` (published reviews only, whitelisted columns, anon + authenticated).
- RPCs: `raise_dispute(p_org, p_contract, p_reason) returns uuid` (party org, contract `active`, one open per contract, sets contract `disputed`); `resolve_dispute(p_dispute uuid, p_outcome text, p_note text)` (`'resume'|'complete'|'cancel'`, platform admin with aal2 via the existing admin wrapper pattern, audited); `post_review(p_org, p_contract, p_rating int, p_comment text) returns uuid` (party org, contract `completed`, one per author org, rating 1–5, comment ≤ 2000). Review `published_at` is set when both have posted or when `reviews.reveal_after_days` has passed (computed in the view and in a `reviews_visible` policy, not by a cron).
- Notifications: dispute raised (other party), review requested on completion (both).

- [ ] **Step 1: Failing pgTAP test** `018`: dispute freezes `approve_milestone` (Review Focus 5) while a succeeded webhook for an already-open session still records the payment and leaves the contract `disputed`; second open dispute rejected; stranger cannot raise or read; non-admin cannot resolve; review before completion rejected; second review by the same org rejected; one-sided review is invisible to the subject org and the public until the other posts or the wait passes (use a settings override of 0 days to prove the time path); view exposes only aggregate columns; self-review (author org = subject org) impossible.
- [ ] **Step 2:** Run `bash scripts/db-test.sh`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bash scripts/db-test.sh`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): disputes, reviews, public ratings`.

### Task 6: Payment provider and webhook handler

**Files:** Create `apps/web/src/lib/payments/provider.ts`, `stripe-provider.ts`, `webhook-handler.ts`, and `.test.ts` for each; `apps/web/src/app/api/webhooks/stripe/route.ts`; Modify `apps/web/src/lib/env.ts` (optional `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and `.env.example`.

**Interfaces:**
- `interface PaymentProvider { createCheckout(i: { paymentId: string; amountMinor: number; applicationFeeMinor: number; currency: string; destinationAccount: string; title: string; successUrl: string; cancelUrl: string; expiresInMinutes: number }): Promise<{ sessionId: string; url: string }>; createOnboardingLink(i: { account?: string; orgId: string; returnUrl: string; refreshUrl: string }): Promise<{ account: string; url: string }>; parseWebhook(rawBody: string, signature: string): Promise<{ id: string; type: string; sessionId?: string; paymentIntentId?: string; accountId?: string; payoutsEnabled?: boolean; detailsSubmitted?: boolean }>; }`.
- `createStripeProvider(secret: string, webhookSecret: string, client?: StripeLike): PaymentProvider`.
- `createWebhookHandler({ provider, store: WebhookStore, db: { recordPaymentSucceeded, recordPaymentFailed, upsertConnectedAccount } }): (rawBody: string, signature: string | null) => Promise<{ status: number }>` using `processOnce`.

- [ ] **Step 1: Failing tests:** handler returns 400 on missing or invalid signature and calls nothing (Review Focus 3); a valid `checkout.session.completed` calls `recordPaymentSucceeded` once and a replay of the same event id calls it zero more times; an `account.updated` for an unknown org is acknowledged without error; unknown event types return 200 and write nothing; a thrown db error returns 500 and releases the claim so the provider retry runs; Stripe adapter test uses `stripe.webhooks.generateTestHeaderString` to prove a good signature parses and a tampered body is rejected; `createCheckout` passes `application_fee_amount` and `transfer_data.destination` and the payment id in metadata to a fake client.
- [ ] **Step 2:** Run `cd apps/web && npx vitest run src/lib/payments`. Expected: FAIL.
- [ ] **Step 3:** `npm i stripe`, implement. Route file only wires the service-role db client, rate-limits nothing (Stripe calls it), reads the raw body with `request.text()`, and returns the handler status.
- [ ] **Step 4:** Run the tests plus `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit `feat(payments): stripe adapter and webhook handler`.

### Task 7: Contract data layer and actions

**Files:** Create `apps/web/src/lib/contracts/{validators,db,actions,present,page-data}.ts` with `.test.ts` for validators, db, actions and present; Modify `apps/web/src/lib/ratelimit.ts` (rules `contractAction`, `checkout`, `dispute`, `review`), `apps/web/src/lib/server.ts` (wire `contractsDb`, `paymentProvider`), `apps/web/src/lib/rbac.ts` (`navFor` adds Contracts), `apps/web/src/lib/route-gate.ts` and `apps/web/src/proxy.ts` (`/contracts` and `/settings` protected), tests for each.

**Interfaces:**
- `createContractsDb(rpc)` mirroring `createMarketplaceDb` (one wrapper per RPC from Tasks 3–5).
- `createContractActions({ db, provider, auth, throttle, revalidate, appUrl })` returning actions `hire`, `setMilestones`, `accept`, `activate`, `submitMilestone`, `requestChanges`, `approveAndPay` (calls `approve_milestone`, then `payment_destination` via the service db, then `provider.createCheckout`, then `attach_checkout_session`, returns `{ ok: true, url }`), `raiseDispute`, `postReview`, `startPayoutOnboarding`. Same `ActionResult` shape as marketplace actions plus optional `url`.
- zod validators: uuid ids, `milestoneItem` (title ≤ 200, description ≤ 2000, amount int ≥ 1, due_date optional ISO date), review rating 1–5, comment ≤ 2000, dispute reason 10–2000.

- [ ] **Step 1: Failing tests:** each action rejects invalid input before auth; unauthenticated returns forbidden; throttled returns rate; a db 42501 maps to forbidden, 22023 to invalid; `approveAndPay` never calls the provider when `approve_milestone` throws, and calls `attach_checkout_session` exactly once on success; a provider failure leaves the pending payment retryable and returns `error`; route-gate treats `/contracts/...` and `/settings/payouts` as protected; `navFor` shows Contracts to client, professional and agency roles.
- [ ] **Step 2:** Run `npx vitest run src/lib`. Expected: FAIL.
- [ ] **Step 3:** Implement following `marketplace/actions.ts`.
- [ ] **Step 4:** Run `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Expected: all green.
- [ ] **Step 5:** Commit `feat(web): contract actions and data layer`.

### Task 8: UI pages and components

**Files:** Create `apps/web/src/components/contracts/*.tsx` (`MilestoneEditor`, `MilestoneList`, `ApproveButton`, `SubmitMilestoneButton`, `ContractStatusBadge`, `DisputeForm`, `ReviewForm`, `PayoutStatus`, `HireButton`, `PaymentNotice`) with `components.test.ts`; pages `apps/web/src/app/(app)/contracts/page.tsx`, `contracts/[id]/page.tsx`, `settings/payouts/page.tsx`; server-action file `apps/web/src/app/(app)/contract-actions.ts`; Modify `ProposalList.tsx` to show a Hire button for shortlisted proposals (client owner/admin only) and `apps/web/src/app/(public)/p/[slug]/page.tsx` to show the aggregate rating from `public_provider_ratings`.

- [ ] **Step 1: Failing tests** with `createElement` and `renderToStaticMarkup`: `PaymentNotice` states payment is due on approval; `ApproveButton` renders only for the client on a `submitted` milestone and not on a disputed contract; `MilestoneList` shows amounts formatted with the currency exponent (JPY 0, KWD 3); `HireButton` absent for non-shortlisted; `ReviewForm` absent before completion; no component renders `stripe_account_id`.
- [ ] **Step 2:** Run `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3:** Implement pages as server components using `page-data.ts` loaders; actions via the `useAction` hook pattern; keep the strict nonce CSP (Checkout is a redirect, no Stripe.js).
- [ ] **Step 4:** Run `npx next typegen && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`. Expected: all green.
- [ ] **Step 5:** Commit `feat(web): contract, payout and review pages`.

### Task 9: Reviews rating on public profile and notifications wiring

**Files:** Modify `apps/web/src/lib/marketplace/public-data.ts` (+test) to read `public_provider_ratings`, `apps/web/src/lib/marketplace/present.ts` notification copy for the new types (+test), `apps/web/src/app/(app)/notifications/page.tsx` link targets (contract notifications deep-link to `/contracts/[id]`).

- [ ] **Step 1: Failing tests:** public data returns rating only when count ≥ 1 and never author or comment fields; present maps each new notification type to a neutral summary with no amounts leaking into email text; contract notifications produce a `/contracts/<id>` href.
- [ ] **Step 2:** Run `npx vitest run src/lib/marketplace`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): public ratings and contract notifications`.

### Task 10: Race tests, e2e, acceptance record

**Files:** Modify `scripts/db-race-test.sh`; Create `apps/web/e2e/contracts-anonymous.spec.ts`, `docs/acceptance-subproject-3.md`; Modify `docs/architecture.md`, `README.md`, spec status line.

- [ ] **Step 1:** Add race cases: 8 concurrent `approve_milestone` calls on one milestone leave exactly one payments row; 8 concurrent `create_contract` calls on one proposal create exactly one contract; 8 concurrent `record_payment_succeeded` for one session leave one succeeded payment. Add the Playwright spec: `/contracts` and `/settings/payouts` redirect anonymous users to sign-in; a public profile with a rating shows it and has no horizontal scroll on a phone viewport.
- [ ] **Step 2:** Run `bash scripts/db-race-test.sh`. Expected: PASS. Then temporarily remove the advisory lock from `approve_milestone`, rerun, expected FAIL (mutation proof), restore.
- [ ] **Step 3:** Run the full suite: `bash scripts/db-test.sh`, `cd apps/web && npx vitest run && npx tsc --noEmit && npm run lint && npm run build`, and the Playwright spec with `PW_CHROMIUM_PATH`. Expected: all green.
- [ ] **Step 4:** Write the acceptance record with a VERIFIED / NOT VERIFIED table. NOT VERIFIED: real Stripe Connect availability for a UAE platform, real Checkout, real webhooks and onboarding, signed-in e2e, whether the 5% + 2% covers Stripe fees.
- [ ] **Step 5:** Commit `docs: sub-project 3 acceptance record`.

### Final

After Task 10, run one whole-branch review on the most capable model (package from `git diff feat/marketplace-core HEAD`), re-grade findings, make one fix pass with failing tests first, ledger minors, then upload the changed files to branch `platform/contracts-payments` and open a PR with base `platform/marketplace-core`.

# PAPple Admin Disputes and Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform Admins can work a dispute queue and rule on disputes, including a full Stripe refund of paid milestones.

**Architecture:** The database is authoritative: `resolve_dispute` records the ruling and queues refunds in one transaction; the server then calls Stripe with a deterministic idempotency key; the verified `charge.refunded` webhook finalizes. Same layering as sub-project 3 (service-only RPCs, `PaymentProvider` boundary, `processOnce` webhooks).

**Tech Stack:** Postgres/Supabase (pgTAP), Next.js server actions, Stripe, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-10-02-papple-admin-disputes-design.md`

## Global Constraints

- Lock order milestone, contract, payment. Errcodes 42501 (not allowed, no aal2) and 22023 (invalid state or input).
- Refund amount is read from the payment row, never from a client. One refund per payment (unique index on `refunds.payment_id`).
- Refunds are full: milestone plus client fee, application fee returned, transfer reversed.
- Admin actions use `createAdminAction` and aal2. Note length 10 to 1,000.
- Migrations are numbered 0019 and 0020; pgTAP files 019 and 020. Existing suite (398 assertions) must stay green.

## Review Focus

- Two payments on one contract: first refund succeeds, second fails, Retry only repeats the failed one.
- `charge.refunded` arrives before the server stored the refund id: webhook must still finalize by payment id.
- Client approves and pays a milestone while the dispute is open: approval is already blocked by `disputed`; pin it.
- Refund event with a different amount or currency than the payment row: reject and log, do not mark refunded.

---

### Task 1: Refund schema (migration 0019)

**Files:** Create `supabase/migrations/0019_refunds.sql`, `supabase/tests/019_refunds.test.sql`.

**Interfaces:** Produces table `refunds(id uuid pk, payment_id uuid unique not null, dispute_id uuid not null, amount bigint, currency text, status text check in ('pending','succeeded','failed') default 'pending', provider_refund_id text, idempotency_key text unique not null, failure_reason text, created_at, updated_at)`; `payments.status` allows `refund_pending`, `refunded`; `disputes.resolution` allows `refund_cancel`.

- [ ] **Step 1:** Write `019_refunds.test.sql` asserting: the two new payment statuses are accepted and `'bogus'` is rejected; a second `refunds` row for the same payment fails with 23505; `idempotency_key` is unique; `anon` and `authenticated` cannot insert or update `refunds`; a contract party and platform staff can select their own contract's refund, a stranger cannot.
- [ ] **Step 2:** Run `scripts/db-race-test.sh` or the project pgTAP command. Expected: 019 FAILS (table missing).
- [ ] **Step 3:** Implement the migration: extend both check constraints, create `refunds` with RLS enabled, revoke all from anon/public/authenticated, grant select to authenticated, select policy via `is_contract_party(contract_id of the payment)` or `is_platform_staff()`, `touch` trigger like `payments_touch`.
- [ ] **Step 4:** Run the full pgTAP suite. Expected: all pass, including 019.
- [ ] **Step 5:** Commit `feat(db): refunds table and statuses`.

### Task 2: Ruling and refund RPCs (migration 0020)

**Files:** Create `supabase/migrations/0020_rule_dispute_refunds.sql`, `supabase/tests/020_rule_dispute.test.sql`.

**Interfaces:** Consumes Task 1 tables. Produces `resolve_dispute(p_dispute uuid, p_outcome text, p_note text) returns void` (replaced; outcomes `resume`,`complete`,`cancel`,`refund_cancel`; note 10 to 1,000 chars); service-only `list_pending_refunds(p_dispute uuid) returns table(payment_id uuid, payment_intent_id text, amount bigint, currency text, idempotency_key text)`, `record_refund_succeeded(p_payment uuid, p_refund text, p_amount bigint, p_currency text) returns text`, `record_refund_failed(p_payment uuid, p_reason text) returns void`.

- [ ] **Step 1:** Write `020` tests: each outcome's end status; `refund_cancel` creates one `refunds` row per succeeded payment, sets those payments `refund_pending`, leaves pending/failed payments untouched; non-admin and aal1 admin get 42501; resolved dispute and short note get 22023; `resume`/`complete`/`cancel` create no refunds; `record_refund_succeeded` marks refund `succeeded` and payment `refunded` and is idempotent; mismatched amount or currency raises 22023 and changes nothing; `record_refund_failed` keeps status `pending` and stores the reason; service RPCs are not executable by `authenticated`.
- [ ] **Step 2:** Run suite. Expected: 020 FAILS.
- [ ] **Step 3:** Implement in the existing lock order. Idempotency key is `refund:<payment_id>`. Keep the existing audit and notification behavior of `resolve_dispute`.
- [ ] **Step 4:** Run full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat(db): rule disputes with refunds`.

### Task 3: Provider refund boundary

**Files:** Modify `apps/web/src/lib/payments/provider.ts`, `stripe-provider.ts`, and their tests.

**Interfaces:** Produces `PaymentProvider.refundPayment(i: { paymentId: string; paymentIntentId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<{ refundId: string }>`; `ProviderEvent` gains `{ kind: "refund_succeeded"; id: string; paymentId: string; refundId: string; amount: number; currency: string }`; `StripeLike` gains `refunds.create(p, opts)`.

- [ ] **Step 1:** Tests in `stripe-provider.test.ts`: `refundPayment` calls `refunds.create` with `payment_intent`, `amount`, `refund_application_fee: true`, `reverse_transfer: true`, `metadata.payment_id`, and passes `idempotencyKey` as the Stripe idempotency option; rejects non-positive amounts; `parseWebhook` maps `charge.refunded` (reading `payment_id` from metadata) to `refund_succeeded` and ignores a refund with no `payment_id`.
- [ ] **Step 2:** Run vitest. Expected: FAIL.
- [ ] **Step 3:** Implement both. Fail closed on missing metadata.
- [ ] **Step 4:** Run vitest. Expected: PASS.
- [ ] **Step 5:** Commit `feat(payments): refund provider boundary`.

### Task 4: Refund service and webhook

**Files:** Modify `service-db.ts`, `webhook-handler.ts` and tests; Create `apps/web/src/lib/payments/refunds.ts`, `refunds.test.ts`.

**Interfaces:** Consumes Tasks 2 and 3. Produces `createPaymentsServiceDb` additions `listPendingRefunds(disputeId)`, `recordRefundSucceeded(i)`, `recordRefundFailed(paymentId, reason)`; `createRefundService({ db, provider }).issueForDispute(disputeId: string): Promise<{ issued: number; failed: number }>`, safe to call again (Retry).

- [ ] **Step 1:** Tests with fakes: all succeed; first succeeds second throws (second recorded failed, first not repeated on retry because the DB no longer lists it as pending after success); retry repeats only pending; idempotency key passed through; webhook `refund_succeeded` calls `recordRefundSucceeded` once through `processOnce` and a replay is a no-op; amount mismatch surfaces as handled error and returns 200 without marking refunded.
- [ ] **Step 2:** Run vitest. Expected: FAIL.
- [ ] **Step 3:** Implement. A `pending` refund stays listed until the webhook finalizes it, so a retry can repeat a call whose webhook is late; the Stripe idempotency key makes that harmless.
- [ ] **Step 4:** Run vitest. Expected: PASS.
- [ ] **Step 5:** Commit `feat(payments): refund service and webhook`.

### Task 5: Admin screens and actions

**Files:** Create `apps/web/src/app/(app)/admin/disputes/page.tsx`, `admin/disputes/[id]/page.tsx`, `admin/disputes/actions.ts`, `apps/web/src/lib/disputes/present.ts`, `present.test.ts`, `validators.ts`, `validators.test.ts`, `components/disputes/RulingForm.tsx`.

**Interfaces:** Consumes Tasks 2 and 4. Produces `ruleDisputeAction(input)` and `retryRefundsAction(input)` via `createAdminAction`; zod `ruleDisputeInput = { disputeId: uuid, outcome: enum[4], note: string 10..1000 }`; `presentDisputeRow(d)` and `rulingChoices(contract, payments)` (offers `refund_cancel` only when at least one payment is `succeeded`).

- [ ] **Step 1:** Tests: validators accept and reject boundaries (note 9 and 10 and 1000 and 1001 chars, bad outcome); `rulingChoices` hides `refund_cancel` with no succeeded payment; queue sorts oldest first; Retry visible only when a refund is `pending`. Add an e2e anonymous spec asserting `/admin/disputes` redirects unauthenticated users.
- [ ] **Step 2:** Run vitest. Expected: FAIL.
- [ ] **Step 3:** Implement presenters, actions, server pages (read through the user's client so RLS applies), and the form. `ruleDisputeAction` calls `resolve_dispute` then `issueForDispute` when the outcome is `refund_cancel`.
- [ ] **Step 4:** Run vitest, `tsc --noEmit`, lint. Expected: clean.
- [ ] **Step 5:** Commit `feat(admin): dispute queue and rulings`.

### Task 6: Docs and acceptance

**Files:** Modify `docs/architecture.md`, `README.md`; Create `docs/acceptance-subproject-4.md`.

- [ ] **Step 1:** Add the refund flow to architecture; add an acceptance table with the NOT VERIFIED rows (live refund, transfer reversal, `charge.refunded` delivery) and the deferred items.
- [ ] **Step 2:** Run the whole suite (pgTAP and vitest) and `tsc`. Expected: all green.
- [ ] **Step 3:** Commit `docs: SP4 acceptance and architecture`.

# Paid Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Priced bookings are paid through Stripe Checkout after confirmation, released if unpaid by `pay_by`, and refunded on cancellation per the fixed rule.

**Architecture:** Migration 0044 adds the price and payment columns, `booking_payments` and `booking_refunds`, and recreates the booking RPCs. The three payment-record functions the webhook calls delegate booking payment ids to new booking functions, so the webhook code stays unchanged. The web app gets `lib/bookings/payments.ts`, which follows the contract `approveAndPay` sequence, plus the actions and UI.

**Tech Stack:** Postgres 16 + pgTAP, Next.js 16, zod 4, vitest 5. The Stripe `PaymentProvider` interface is unchanged.

**Spec:** `docs/superpowers/specs/2026-10-15-papple-paid-bookings-design.md`

## Global Constraints
- Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate, 55000 not in the right state.
- Fee math is the same as `approve_milestone` / `lib/money.ts applyBps` (half up).
- Webhook outcomes are text: `recorded | duplicate | duplicate_charge | mismatch | unknown | paid_on_cancelled | failed | ignored`.
- Settings: `bookings.payment_window_hours` (24) and `bookings.client_refund_cutoff_hours` (24).
- The price is 1..10,000,000 minor units.
- Verify commands are the same as the bookings plan.

## Review Focus
1. The client cancels at exactly `starts_at - 24h`. Expect a full refund (`>=` cut-off). Covered by pgTAP, Task 1.
2. A webhook for a booking payment with `client_total + 1`. Expect `mismatch` and still unpaid. Covered by pgTAP, Task 1.
3. A payment completes after `pay_by` has passed. Expect it recorded, the booking cancelled and a refund queued (`paid_on_cancelled`). Covered by pgTAP, Task 1.
4. Two parallel `booking_pay` calls. Expect one payments row; the attach compare-and-set leaves one session. Covered by the race test and vitest, Tasks 1 and 2.
5. A contract milestone payment through the recreated `record_payment_succeeded`. Expect unchanged behaviour. Covered by pgTAP (the existing 017 and 021 tests stay green, plus a routing assertion), Task 1.

---

### Task 1: Database (0044, pgTAP 044, race)
Files: `supabase/migrations/0044_paid_bookings.sql`, `supabase/tests/044_paid_bookings.test.sql`, `scripts/db-race-test.sh`.
Produces the RPCs and tables named in the spec's Data section, with exactly those signatures.
- [ ] Write pgTAP covering every bullet in the spec's Tests list for pgTAP, then run it: expect 044 to fail (functions missing).
- [ ] Write the migration. Recreated functions keep their previous bodies verbatim after the delegation prelude. Run: all pass, including 015–021 and 041–043.
- [ ] Add the race case (6 parallel `booking_pay` calls → 1 row). Commit.

### Task 2: Library and actions
Files: `lib/bookings/payments.ts` (+ test), `lib/bookings/service.ts` (price input, cancel outcome), `lib/bookings/present.ts` (payment labels, price text), `lib/server.ts` wiring, `app/(app)/booking-actions.ts`.
- [ ] Write vitest per the spec's Tests list for vitest, then run it: expect FAIL.
- [ ] Implement, then run vitest and typecheck: expect PASS. Commit.

### Task 3: UI and docs
Files: settings page price field, `BookingPicker` price line (from `booking_price_offer`), bookings page payment states and buttons, acceptance doc, README, status.
- [ ] Implement. Then run the full verification: DB, race, lint, typecheck, test, build and e2e. Commit.

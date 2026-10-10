# PAPple budgets — design (procurement slice 2)

Status: design approved by the owner in chat on 2026-10-10 ("yes, continue" to option 1: one organization budget per month or quarter; an admin going over it needs an owner's approval). Spec and plan reviews are delegated, as for the earlier slices.

## Goal
A client organization's owners set a spending budget for the current month or quarter. Everyone acting for the organization sees how much is used. An admin cannot commit spend past the budget without an owner's sign-off. Owners can, but they see a warning.

## Understanding
- **Said:** option 1. One budget per organization for a month or a quarter. Counted spend is the price of accepted contracts in the period, plus paid bookings. An admin acceptance that would go over the budget goes through the existing owner-approval flow, with "over budget" as the reason. Owners accept directly with a warning. Usage is visible to owners, admins and members.
- **Assumed:**
  - Periods are calendar months or quarters in UTC, the same as every other time boundary in the database.
  - Amounts are in one currency with no conversion. A contract in another currency cannot be checked against the budget, so it needs approval (the threshold rule already treats a foreign currency this way). Booking payments in another currency are listed as "not counted".
- **Ruling: when a contract counts.** A contract counts from the moment the client side accepts it (a new `contracts.client_accepted_at`), in the period of that moment, for its full price. A contract cancelled after acceptance counts only what was actually paid on it (payments still `succeeded`). Contracts accepted before this migration get `client_accepted_at = created_at`, which is the best date available.
- **Ruling: bookings are counted but not gated.** A paid booking counts its price in the period of `paid_at`, unless it was refunded or a refund is pending. Paying is never blocked; the bookings page warns the client when paying would go over.
- **Ruling: one request for both reasons.** The threshold check and the budget check produce one `spend_requests` row. A new column `reasons text[]` holds `threshold` and/or `budget`. An approval does not re-check the budget: the owner approves knowingly.
- **Success:**
  - Parallel admin acceptances cannot both slip under the remaining budget.
  - The numbers on the page equal the database's count.
  - The provider side and other organizations never see the client's budget or spend.

## Non-goals (later)
Multi-step or multi-approver chains, budgets per project, person or category, currency conversion, carrying unused budget over, alerts by email or at a percentage, gating booking payments, purchase orders.

## Rules
- **Budget:** `budgets(org_id pk, enabled, period 'month'|'quarter', amount_minor 1..2,147,483,647, currency, updated_by, updated_at)`. Only owners set it, through `budget_set(p_org, p_enabled, p_period, p_amount, p_currency)`. Changes are audited (`budget.set`, with before and after).
- **Status:** `budget_status(p_org)` for owners, admins and members (viewers and other organizations: 42501). Returns jsonb: `{enabled, period, period_start, period_end, currency, limit, spent, remaining, contracts, bookings, other_currency}`, or `null` when no budget exists. `remaining` may be negative. `other_currency` counts items in another currency that were not added.
- **Spend in a period** (`budget_spent(p_org, p_from, p_to, p_currency)`, internal):
  - Contracts where `client_org_id = p_org`, `client_accepted_at` in `[from, to)`, currency matches: the price, or for cancelled contracts the sum of their `succeeded` payments' `amount`.
  - Booking payments where the booking's `client_org_id = p_org`, status `succeeded`, `paid_at` in `[from, to)`, currency matches: the payment's `amount` (the booking price, before the client fee, like contract prices).
- **Accept** (`accept_contract`, client side, enabled budget):
  - Takes an advisory lock `budget:<org>` before counting, so parallel acceptances queue.
  - Not an owner, and (the contract currency differs from the budget or `spent + price > limit`): the request gets reason `budget`.
  - Combined with the existing threshold rule into one request (`reasons` holds both when both apply). The existing pending-request reuse and lapse logic is unchanged, plus the reasons must match for reuse.
  - Owners accept directly; the page shows the over-budget warning before they click.
  - Sets `client_accepted_at = now()` whenever `accepted_by_client` becomes true; `spend_request_decide` does too on approval.
- **Errcodes:** 42501 not allowed, 22023 invalid.

## Data (migration 0045)
- `budgets` table, RLS: select for owners and admins (as `spend_policies`); members read only through `budget_status`. No direct writes.
- `contracts.client_accepted_at timestamptz` (backfilled from `created_at` where `accepted_by_client`), readable like the other contract columns.
- `spend_requests.reasons text[] not null default '{threshold}'` (existing rows were all threshold requests).
- Functions: `budget_set`, `budget_status`, internal `budget_spent` and `budget_period(p_period, p_at) returns tstzrange`. `accept_contract` and `spend_request_decide` are recreated (bodies otherwise unchanged from 0041 and 0042).

## Server and UI (apps/web)
- `lib/budgets/service.ts`: `createBudgetsService(deps)` with `save` (major-unit text to minor units, no silent rounding, as the spend threshold) and `status` (validated jsonb).
- `lib/budgets/present.ts`: the meter label ("$6,200 of $10,000 used this quarter"), the over-budget wording, the period label, and the approval reason labels ("Above the approval threshold", "Over budget").
- **Pages:**
  - `/settings/approvals`: a Budget card for owners (on or off, month or quarter, amount, currency).
  - `/approvals`: the usage meter for owners and admins, and each request shows its reasons.
  - The contract page (client side, draft): the meter and "Accepting this contract would go over the budget by X" before Accept; an admin sees that it will go to an owner.
  - `/bookings` (client side, a booking due for payment): "Paying this booking would go over the budget" when it would.
- Actions reuse the `approvals` rate rule.

## Tests
- **pgTAP (`045_budgets.test.sql`):**
  - Roles: owners set, admins and members read status, viewers and other organizations cannot; no direct writes.
  - Period edges: the last second of a month or quarter and the first second of the next (UTC).
  - Counting: accepted contracts, cancelled-after-acceptance counting only paid, other currency excluded and counted in `other_currency`, paid bookings counted, refunded and refund-pending bookings not counted.
  - Accept routing: admin under budget accepts; admin over budget gets `approval_requested` with reasons `{budget}`; threshold and budget give `{threshold,budget}`; a foreign-currency contract needs approval; an owner over budget accepts; a disabled budget does nothing; approval sets `client_accepted_at`.
  - The existing 041 and 042 suites stay green.
- **Race:** two admins accept two different contracts at once, each fitting the remaining budget alone but not together: exactly one is accepted, the other becomes an approval request.
- **vitest:** amount parsing, status validation, presenter labels, action error mapping.
- **e2e:** existing anonymous gates (no new routes).

## Review focus
- A path that lets an admin commit past the budget without an owner (parallel accepts, a currency trick, a stale pending request reused after the reasons changed).
- Off-by-one at period boundaries.
- Double counting (a contract and its payments; a booking and its refund).
- Members or other organizations reading more than the status, or the provider side seeing anything.
- The recreated `accept_contract` and `spend_request_decide` changing threshold behaviour.

# Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners set a monthly or quarterly budget; spend (accepted contracts plus paid bookings) is counted per period; an admin acceptance that would go over the budget becomes an owner approval request.

**Architecture:** Migration 0045 adds `budgets`, `contracts.client_accepted_at` and `spend_requests.reasons`, the functions `budget_set`, `budget_status`, `budget_spent` and `budget_period`, and recreates `accept_contract` and `spend_request_decide`. The web app gets `lib/budgets/{service,present}.ts`, actions and UI on the existing approvals, contract and bookings pages.

**Tech Stack:** Postgres 16 + pgTAP, Next.js 16, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-16-papple-budgets-design.md`

## Global Constraints
- Errcodes: 42501 not allowed, 22023 invalid.
- Periods are UTC calendar months or quarters, half-open `[start, end)`.
- No currency conversion.
- Verify: `bash scripts/db-test.sh`, `bash scripts/db-race-test.sh`; in `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the Playwright suite.

## Review Focus
1. Two admins accept two contracts at once that only fit one at a time. Expect one accepted and one request (race test, Task 1).
2. A contract accepted at `23:59:59` on the last day of a quarter. Expect it to count in that quarter only (pgTAP, Task 1).
3. A cancelled contract with one paid milestone. Expect only the paid amount counted (pgTAP, Task 1).
4. A pending threshold request, then the budget is set so the contract is also over budget. Expect the admin's re-accept to lapse and replace it with reasons `{threshold,budget}` (pgTAP, Task 1).
5. Existing spend-approval behaviour. Expect suites 041 and 042 unchanged and green (Task 1).

---

### Task 1: Database (0045, pgTAP 045, race 27)
**Files:** `supabase/migrations/0045_budgets.sql`, `supabase/tests/045_budgets.test.sql`, `scripts/db-race-test.sh`.
- [ ] Write `045_budgets.test.sql` covering the spec's pgTAP list; run `bash scripts/db-test.sh` and see it fail because the functions are missing.
- [ ] Write 0045: table, RLS, columns with backfill, `budget_period`, `budget_spent`, `budget_status`, `budget_set`, recreated `accept_contract` (advisory lock, reasons, `client_accepted_at`) and `spend_request_decide` (`client_accepted_at`), grants and revokes.
- [ ] Run the DB tests until everything passes, including 041/042.
- [ ] Add race case 27; see it pass; check it fails without the advisory lock.
- [ ] Commit.

### Task 2: Library and actions
**Files:** `apps/web/src/lib/budgets/{service,present}.ts` and tests, `lib/server.ts` (`budgetsService`), `app/(app)/budget-actions.ts`, `lib/approvals/present.ts` (reason labels).
- [ ] Tests first: amount parsing (no rounding, empty refused), status validation, presenter labels, error mapping.
- [ ] Implement; run `pnpm test`.
- [ ] Commit.

### Task 3: UI and docs
**Files:** `components/budgets/*`, `app/(app)/settings/approvals/page.tsx`, `app/(app)/approvals/page.tsx`, the contract page, `app/(app)/bookings/page.tsx`, `docs/acceptance-budgets.md`, `README.md`, `docs/PROJECT_STATUS.md`, `docs/PROJECT_AUDIT.md`.
- [ ] Budget card, meter, warnings and request reasons.
- [ ] Full verification; commit.
- [ ] Independent review, fixes, PR.

# Approval Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amount tiers decide how many different owners must approve a contract; an owner's accept counts as the first approval in multi-owner tiers.

**Architecture:** Migration 0047 adds `spend_tiers`, `spend_approvals` and `spend_requests.approvals_required`, the functions `spend_tiers_set` and `spend_required`, and recreates `accept_contract` and `spend_request_decide`. The web app extends `lib/approvals` (service and presenter) and the approvals, settings and contract pages.

**Tech Stack:** Postgres 16 + pgTAP, Next.js 16, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-17-papple-approval-tiers-design.md`

## Global Constraints
- Errcodes: 42501, 22023, 23505 (already approved), 55000.
- Lock order everywhere: contract, then the budget advisory lock (if a budget exists), then the spend request.
- Verify: `bash scripts/db-test.sh`, `bash scripts/db-race-test.sh`; in `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus Playwright.

## Review Focus
1. An admin's request in a two-owner tier: one owner gives `partial` and the contract is not accepted (pgTAP).
2. The same owner approves twice: 23505 (pgTAP).
3. An owner accepts a contract in a two-owner tier: `approval_requested`, not accepted (pgTAP).
4. Two owners approve at once: accepted once, 2 approvals (race case 29).
5. No tiers: the 041, 042 and 045 suites are unchanged and green.

---

### Task 1: Database (0047, pgTAP 047, race 29)
- [ ] Write `047_approval_tiers.test.sql`; see it fail.
- [ ] Write 0047; make all DB suites pass.
- [ ] Add race case 29; check it fails if the decision does not lock the contract first; commit.

### Task 2: Library and actions
- [ ] Tests first: `setTiers` parsing, the `partial` outcome, presenter progress, tier summary and owner-accept wording.
- [ ] Implement `lib/approvals/{service,present}.ts` and add `setSpendTiersAction`; commit.

### Task 3: UI and docs
- [ ] Tier editor, progress on approvals and the contract banner.
- [ ] Acceptance record, README, status and audit; full verification; commit.
- [ ] Independent review, fixes, PR.

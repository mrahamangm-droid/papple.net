# Owner Sign-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changes that loosen the approval rule, tiers or budget, or change who the owners are, need a second owner's confirmation when the organization has one.

**Architecture:** Migration 0048 adds `owner_changes`, moves each setter's effect into an internal `*_apply` function, and recreates the public setters (text return: `applied` | `pending`). It also adds `owner_change_decide` and `owner_change_cancel`. The web app passes outcomes through and adds a "Settings changes" section on `/approvals`.

**Tech Stack:** Postgres 16 + pgTAP, Next.js 16, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-18-papple-owner-sign-off-design.md`

## Global Constraints
- Errcodes: 42501, 22023, 55000.
- `*_apply` functions are revoked from public, anon and authenticated.
- Verify: `bash scripts/db-test.sh`, `bash scripts/db-race-test.sh`; in `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus Playwright.

## Review Focus
1. Two owners: A clears the tiers and gets `pending`; the tiers are unchanged (pgTAP).
2. A removes B and gets `pending`; B is still an owner until someone confirms (pgTAP).
3. A promotes a second account to owner and gets `pending`; that account cannot confirm A's other changes until promoted (pgTAP).
4. A user calls `spend_tiers_apply` directly and gets 42501 (pgTAP).
5. A confirms an expired change and gets 55000 (pgTAP).

---

### Task 1: Database (0048, pgTAP 048, race 30)
- [ ] Write the pgTAP suite and see it fail; write 0048; update earlier suites only where a return type changed; all DB suites green; race case; commit.

### Task 2: Library and actions
- [ ] Tests first for outcome pass-through and wording; implement in approvals, budgets and team services; add the decide and cancel actions; commit.

### Task 3: UI and docs
- [ ] The "Settings changes" section and pending notices in forms; acceptance record, README, status and audit; full verification; review; PR.

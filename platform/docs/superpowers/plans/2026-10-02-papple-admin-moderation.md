# PAPple Admin console slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Moderation queue, taxonomy editor and admin overview, all guarded and audited.
**Architecture:** As slice 1: SECURITY DEFINER functions are the authority, a testable actions factory sits behind `adminAction`, screens read through the user's session.
**Tech Stack:** Postgres/Supabase (pgTAP), Next.js server actions, zod, vitest.
**Spec:** `docs/superpowers/specs/2026-10-02-papple-admin-moderation-design.md`

## Global Constraints
Rules in the spec's "Rules for every write". Migrations 0026 and 0027, pgTAP 026 and 027. Existing suites stay green (DB 548, vitest 447). `scripts/check-rls-coverage.sql` stays clean.

## Review Focus
As in the spec's Review focus.

### Task 1: Moderation functions (migration 0026)
**Files:** Create `supabase/migrations/0026_moderation.sql`, `supabase/tests/026_moderation.test.sql`.
**Interfaces:** Produces `moderation_queue(int)`, `hidden_items(int)`, `dismiss_report(uuid, text)`, replaces `admin_set_visibility(text, uuid, boolean, text)` with a required reason.
- [ ] Step 1: pgTAP test: user/anonymous/support-without-aal2 refused (42501); support with aal2 can read the queue and dismiss; queue returns oldest first with `open_count` and labels; message label shown; hide with short or null reason gets 22023; hide marks open reports actioned; dismiss twice gets 22023; hidden_items lists the hidden target; unhide works; every write audited.
- [ ] Step 2: run `bash scripts/db-test.sh`; Expected: 026 FAILS.
- [ ] Step 3: implement.
- [ ] Step 4: run again; Expected: all pass.
- [ ] Step 5: commit `feat(db): moderation queue, dismiss and mandatory reasons`.

### Task 2: Taxonomy functions (migration 0027)
**Files:** Create `supabase/migrations/0027_taxonomy_admin.sql`, `supabase/tests/027_taxonomy_admin.test.sql`.
**Interfaces:** Produces `admin_save_category(...)`, `admin_save_skill(...)` per spec; drops `categories_admin_write` and `skills_admin_write` and revokes insert/update/delete.
- [ ] Step 1: pgTAP test: access matrix; create category and skill; slug fixed on update; invalid slug, short name, duplicate slug refused (22023 / 23505 mapped to 22023); parent cycle and depth over 2 refused; deactivate keeps existing rows; direct UPDATE as admin aal2 refused; audited with reason.
- [ ] Step 2: run; Expected: 027 FAILS. Step 3: implement. Step 4: run; Expected: all pass (existing taxonomy tests adjusted if they wrote directly). Step 5: commit `feat(db): guarded taxonomy edits`.

### Task 3: Library
**Files:** Create `apps/web/src/lib/admin/moderation.ts` (validators, presenters), `moderation.test.ts`; extend `db.ts`, `actions.ts`, `actions.test.ts`.
**Interfaces:** Produces `hideInput {kind: profile|service|project, id, hidden, reason}`, `dismissInput {reportId, reason}`, `categoryInput`, `skillInput`; db methods `setVisibility`, `dismissReport`, `saveCategory`, `saveSkill`; actions of the same names with aal2 checks.
- [ ] Step 1: tests (bounds, kinds, aal2 before any db call, error mapping, revalidated paths `/admin/reports`, `/admin/taxonomy`). Step 2: run, Expected FAIL. Step 3: implement. Step 4: run, Expected PASS plus `tsc`. Step 5: commit.

### Task 4: Screens
**Files:** Create under `apps/web/src/app/(app)/admin/`: `reports/page.tsx`, `reports/hidden/page.tsx`, `taxonomy/page.tsx`; extend `actions.ts`, `components/admin/ConsoleForms.tsx`; rewrite `admin/page.tsx` as the overview; extend `e2e/contracts-anonymous.spec.ts`.
- [ ] Step 1: add anonymous e2e for the three routes. Step 2: implement screens. Step 3: run vitest, tsc, eslint, `next build`, anonymous Playwright; Expected all green. Step 4: commit.

### Task 5: Docs
**Files:** Create `docs/acceptance-subproject-4c.md`; modify `docs/architecture.md`, `README.md`.
- [ ] Run the full evidence set (`db-test.sh`, `db-race-test.sh`, vitest, tsc, eslint, build, anonymous Playwright); commit.

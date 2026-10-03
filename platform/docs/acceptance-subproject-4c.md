# Sub-project 4c (Admin moderation, taxonomy, overview) — acceptance record

Run date: 2026-10-02 · Branch: `feat/admin-moderation` (built on slice 1, PR #24). Executed on the owner's "1, 2" reply to the design; no separate spec or plan review.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs the owner's accounts, a live service or real data.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Queue, dismiss, hide and restore need staff + aal2 and a 10-1,000 character reason; hiding actions open reports; all audited | **VERIFIED (pgTAP)** | `026_moderation.test.sql`, `012_reports.test.sql` |
| 2 | Taxonomy saves need admin + aal2 + reason; slug fixed; two levels; inactive-category rule; no deletes; direct admin writes refused | **VERIFIED (pgTAP)** | `027_taxonomy_admin.test.sql`, `006` |
| 3 | Inputs, aal2 before database call, error mapping | **VERIFIED (unit)** | `lib/admin/moderation.test.ts`, `actions.test.ts` |
| 4 | New routes redirect signed-out users; build, types, lint clean | **VERIFIED (e2e anonymous + build)** | Playwright, `next build`, `tsc`, `eslint` |
| 5 | The screens signed in with MFA | **NOT VERIFIED** | Needs an admin account with MFA |
| 6 | A support-staff screen | Not built | Screens are admin-only; the database already accepts support staff |

## Deferred
- Hidden items show no hidden-since date or the reason it was hidden (the reason is in the audit log).
- Reordering categories is a numeric position field, not drag and drop.

## Review fixes applied (migration 0028, pgTAP 028)
Locks before the category depth check; an active skill or subcategory blocks deactivating its category; an active child cannot sit under an inactive parent; restoring a target that is not hidden is refused; the screens show an error or second-factor prompt instead of "nothing here" when the queue cannot load; audit labels added.

## Deferred minors
- The app-level audit row says success even when the database refused the action (same as slice 1).
- `hidden_items` has no ordering or paging; the queue is one row per report, capped at 50.
- The overview's recent activity has no links and also shows the console wrapper rows.
- Taxonomy dropdowns still offer choices the database will refuse.
- No concurrency test for the category depth lock (the reviewer reproduced the original race by hand).

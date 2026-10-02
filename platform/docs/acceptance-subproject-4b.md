# Sub-project 4b (Admin console, first slice) — acceptance record

Run date: 2026-10-02 · Branch: `feat/admin-console` (built on `feat/admin-disputes`). Executed on the owner's "approved" and "approve" of the design and spec; the plan was not separately reviewed.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs the owner's accounts, a live service or real data.

## Requirements
| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Settings, flags and plans change only through admin + aal2 + reason functions; unknown keys, wrong JSON types and bad plan data are refused; history and audit record old value, new value, actor and reason | **VERIFIED (pgTAP)** | `022_admin_config.test.sql` |
| 2 | Registry ranges (bps 0-10000, expiry 30-1440 minutes, etc.) and reason bounds are enforced before the database is called | **VERIFIED (unit)** | `lib/admin/validators.test.ts`, `actions.test.ts` |
| 3 | Admin actions refuse without a second factor before any database call | **VERIFIED (unit)** | `lib/admin/actions.test.ts` |
| 4 | Suspending an organization removes public listing and member access, keeps counterparty and admin access, still records payments in flight; restoring reverses it | **VERIFIED (pgTAP)** | `023_admin_orgs_roles.test.sql` |
| 5 | Staff roles: no self-change, unknown roles refused, an administrator always remains, a revoked admin loses power | **VERIFIED (pgTAP)** | `023` |
| 6 | Verification request, review, revoke; owners cannot write `verified_at`; one pending per organization; the public view exposes `verified` and no organization ids | **VERIFIED (pgTAP)** | `024_verification.test.sql` |
| 7 | Audit viewer filters and keyset paging parse safely | **VERIFIED (unit)** | `validators.test.ts` |
| 8 | All new routes redirect signed-out users to /signin; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | Playwright anonymous, `next build`, `tsc`, `eslint` |
| 9 | The screens signed in with MFA (forms, confirm dialogs, badge on live pages) | **NOT VERIFIED** | Needs an admin account with MFA |
| 10 | Two admins revoking each other at the same moment | **NOT VERIFIED** | The role rows are locked before the check, but no concurrent test was written |

## Deferred
- The settings cache in the app can serve an old value for a short time after an edit.
- Audit rows are written twice per console edit (a wrapper row and the database row with the reason).
- Plan edits do not touch the Stripe price.

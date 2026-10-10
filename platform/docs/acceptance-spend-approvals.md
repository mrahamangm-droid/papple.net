# Spend approvals (procurement slice 1) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes"); spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Only owners set the rule; threshold and currency validated; the provider side and members cannot read it | **VERIFIED (pgTAP)** | `041_spend_approvals.test.sql` |
| 2 | Owners, accepts below the threshold, the provider side and organizations without a rule accept directly | **VERIFIED (pgTAP)** | same |
| 3 | An admin at or above the threshold, or in another currency, creates one pending request; owners notified without amounts; a repeat call reports it pending | **VERIFIED (pgTAP)** | same |
| 4 | Changed milestones lapse a request, at accept time and at decision time; cancelling the draft, an owner accepting directly, or an admin accepting after the rule changed lapses it at once; the fingerprint is not fooled by separators in titles | **VERIFIED (pgTAP)** | same |
| 5 | Only an owner who did not make the request decides (including an admin promoted later); rejection needs a reason; requester notified | **VERIFIED (pgTAP)** | same |
| 6 | Withdraw by the requester or an owner only; no direct table writes; every change audited | **VERIFIED (pgTAP)** | same |
| 7 | Parallel admin accepts create exactly one request | **VERIFIED (race)** | `scripts/db-race-test.sh` case 22 |
| 8 | Amount parsing (no separators, signs, exponents, extra decimals or out-of-range values), error mapping, outcome pass-through, notification copy, nav | **VERIFIED (unit)** | `lib/approvals/*.test.ts`, `lib/contracts/*.test.ts`, `lib/rbac.test.ts`, `lib/route-gate.test.ts` |
| 9 | `/approvals` and `/settings/approvals` send signed-out visitors to sign-in; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | `e2e/approvals-anonymous.spec.ts`, `next build`, `tsc`, `eslint` |
| 10 | The screens signed in: setting a rule, an admin's accept showing the notice, an owner approving and rejecting | **NOT VERIFIED** | Needs live Supabase Auth and two test accounts (staging run-through) |

## Known limits
- No currency conversion: a contract in another currency always needs approval.
- One approver (any owner). No multi-step chains, per-person limits, budgets or purchase orders.
- Notifications carry the organization so links open the right one; pages without `?org=` prefer an organization the person manages.

## Review fixes applied (same migration 0041, before merge)
Pending requests lapse when the contract is accepted another way or cancelled (`spend_lapse_pending`, `cancel_contract` recreated with the same body plus that call); the terms fingerprint uses a jsonb encoding; approval notifications carry `org_id` and link to `/approvals?org=`; the approvals pages prefer a managed organization and always show the organization switcher.

## Follow-ups applied (migration 0042)
- Deciding locks the contract before the request, the same order as accepting. Race case 23 reproduced a deadlock in 9 of 10 runs before the change and 0 after.
- A request that is no longer pending answers 55000; the app shows "This request was already decided or withdrawn" instead of "not valid".
- `lib/server.ts` comments sit above the right functions; the spec notes the as-built file layout.

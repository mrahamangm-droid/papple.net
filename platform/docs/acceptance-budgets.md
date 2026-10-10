# Budgets (procurement slice 2) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes, continue" to option 1); spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Only owners set the budget (month or quarter, amount, currency), validated and audited; admins, members and other organizations cannot | **VERIFIED (pgTAP)** | `045_budgets.test.sql` |
| 2 | Owners, admins and members read usage through `budget_status`; viewers, the provider side and other organizations cannot; no direct writes | **VERIFIED (pgTAP)** | same |
| 3 | Periods are UTC calendar months or quarters, half-open: the last second of a quarter counts in it, the first second of the next does not | **VERIFIED (pgTAP)** | same |
| 4 | Counting: accepted contracts at full price, a cancelled one only what was paid, other currencies listed not added, paid bookings counted, refunded or refund-pending bookings not | **VERIFIED (pgTAP)** | same |
| 5 | An admin within budget accepts; over budget or in another currency gets an owner approval request with reasons; threshold and budget give one request with both reasons; a pending request is replaced when its reasons change; owners go over with a warning; approval records the acceptance time | **VERIFIED (pgTAP)** | same; suites 041/042 unchanged and green |
| 6 | Two admins accepting at once cannot both slip under the remaining budget | **VERIFIED (race)** | `scripts/db-race-test.sh` case 27 (fails without the per-organization lock) |
| 7 | Amount parsing without rounding, status validation, meter and warning wording, reason labels, error mapping | **VERIFIED (unit)** | `lib/budgets/*.test.ts` |
| 8 | Pages still refuse signed-out visitors; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | Playwright suite |
| 9 | The screens signed in: setting a budget, the meter, the warning before Accept, an over-budget request on `/approvals` | **NOT VERIFIED** | Needs live Supabase Auth and two test accounts (staging run-through) |

## Known limits
- One budget per organization; no budgets per project, person or category, no carry-over, no alerts.
- No currency conversion: a contract in another currency needs an owner when a budget is on; other-currency spend is listed, not added.
- Paid bookings count but are never blocked.
- Contracts accepted before this migration count from their creation date (the best date available).

## Also fixed on this branch
- `scripts/db-test.sh` now fails when a suite runs fewer assertions than it plans; `044_paid_bookings` planned 75 but has 73.
- `043_bookings`' horizon test picked a date inside the 30-day horizon on Saturdays and Sundays; it now uses a date 35-42 days out.

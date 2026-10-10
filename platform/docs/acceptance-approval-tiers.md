# Approval tiers (procurement slice 3) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes to option 1"); spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Only owners set tiers; 1 to 3 approvals, never more than the organization's owners, one tier per amount, no negative amounts; audited | **VERIFIED (pgTAP)** | `047_approval_tiers.test.sql` |
| 2 | Required approvals: the highest matching tier (at the edge, above the top), the highest tier for another currency, one with the rule off or below every tier | **VERIFIED (pgTAP)** | same |
| 3 | An admin's request needing two: the first owner gives `partial`, the same owner again is refused, a second owner completes it and the contract is accepted; one rejection ends it; changed terms lapse it | **VERIFIED (pgTAP)** | same |
| 4 | An owner's accept in a two-owner tier is only the first approval; that owner cannot approve again; a second owner completes it | **VERIFIED (pgTAP)** | same |
| 5 | One-owner tiers and organizations without tiers behave as before | **VERIFIED (pgTAP)** | same; suites 041, 042, 045 green |
| 6 | Two owners approving at once complete the request exactly once | **VERIFIED (race)** | `scripts/db-race-test.sh` case 29 (fails without the row locks) |
| 7 | The provider reads no approvals or tiers | **VERIFIED (pgTAP)** | same |
| 8 | Tier input parsing without rounding, the `partial` outcome, progress and summary wording | **VERIFIED (unit)** | `lib/approvals/*.test.ts` |
| 9 | Pages still refuse signed-out visitors; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | Playwright suite |
| 10 | The screens signed in with two owners | **NOT VERIFIED** | Needs the staging run-through |

## Known limits
- Approvers are owners only; no named sequential chains, delegation while away, deadlines or reminders.
- If owners leave after a request was made, it can become impossible to complete; the page says so and an owner can reject it (it never downgrades on its own).

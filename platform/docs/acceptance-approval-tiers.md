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

## Review fixes applied (independent review, same migration 0047, before merge)
- A request made before the tiers were raised now lapses, instead of being completed by one owner.
- Tiers apply only at or above the rule's threshold, so a budget-only request below it can't need two owners that an owner's own accept would skip.
- Approvals given through Accept are audited and notified like those given through Approve. The final approval's audit names every approver, so the record survives a deleted account.
- Tier input is validated strictly (objects only, both fields, whole numbers), and the audit keeps the normalized tiers. Saves are serialized per organization. Tiers store their currency, which the server checks against the rule's; if the rule's currency changes later, the highest tier applies.
- A requester never counts as an approver, on either path, including an admin promoted to owner.
- Copy: "You approved; waiting for another owner", the lapsed message, the rule summary, the approvals intro and the progress notification. The tier form warns when a stored tier asks for more approvals than there are owners. Other owners are notified when tiers change.

## Known limits
- **This guards the normal flow, not a rogue owner.** One owner can loosen the protection (clear the tiers, switch the rule off, or promote another account to owner). Every tier change is audited and the other owners are notified. Two-owner sign-off on settings and promotions would be a separate slice.
- Approvers are owners only; no named sequential chains, delegation while away, deadlines or reminders.
- If owners leave after a request was made, it can become impossible to complete; the page says so and an owner can reject it (it never downgrades on its own).

# PAPple owner sign-off — design (procurement slice 4)

Status: design approved by the owner in chat on 2026-10-10 ("yes please"). Spec and plan reviews are delegated, as for the earlier slices.

## Goal
Close the gap the approval-tiers review found: one owner can loosen the organization's protection on their own. Changes that weaken a control need a second owner to confirm before they take effect. Changes that strengthen a control apply at once.

## Understanding
- **Said:**
  - Changes that need a second owner: lowering or clearing approval tiers; switching the approval rule off or raising its threshold; raising or switching off a budget; promoting someone to owner.
  - A single-owner organization works as today.
  - A pending change can be cancelled by its author and expires after 7 days.
  - Pending changes are listed on `/approvals`, and the other owners are notified.
- **Ruling: removing or demoting another owner also needs confirmation.** Otherwise owner A removes owner B, becomes the only owner, and is back to acting alone. The confirmer may be any owner other than the requester, including the owner being removed. An owner leaving by themselves is unchanged.
- **Ruling: currency and period changes count as loosening.** Changing the rule's or the budget's currency reinterprets stored amounts, and a quarterly budget spans more than a monthly one, so these changes are never applied silently.
- **Ruling: one pending change per subject.** Subjects are: the rule, the tiers, the budget, and each member's role. A newer request replaces an older pending one for the same subject; the older one is marked `superseded`.
- **Success:**
  - With two or more owners, no single owner can loosen the rule, tiers or budget, or change who the owners are, even by calling the database directly.
  - Tightening is never delayed.
  - Single-owner organizations see no change.

## Non-goals (later)
Sign-off by more than two owners, delegation, changes to plans and billing, a sign-off requirement for the first owner's own actions in a new organization.

## Rules
- **`owner_changes`:**
  - columns: `id`, `org_id`, `kind` ('policy' | 'tiers' | 'budget' | 'role' | 'remove'), `subject` (text: '' or a user id), `payload` (jsonb), `requested_by`, `status` ('pending' | 'confirmed' | 'rejected' | 'cancelled' | 'superseded'), `decided_by`, `decided_at`, `created_at`, `expires_at` (created + 7 days);
  - one pending row per (org, kind, subject);
  - RLS select for owners and admins; no direct writes.
- **Loosening tests** (all compare the stored state with the requested one):
  - **policy:** the stored rule is on, and the new one is off, has a higher threshold, or uses another currency.
  - **tiers:** at some amount, the new required count is lower than the stored one. Every tier minimum (old and new, and 0) is checked. Another currency also counts.
  - **budget:** the stored budget is on, and the new one is off, larger, a different period, or in another currency.
  - **role:** promoting a member who is not an owner to owner, or demoting another owner.
  - **remove:** removing another owner.
- **When a change is loosening and the organization has another owner besides the requester:**
  - insert a pending `owner_changes` row (superseding any older pending one for the same subject);
  - notify the other owners (`owner_change_requested`);
  - return `pending`.
  - Otherwise apply it now and return `applied`.
- **Public setters:** `spend_policy_set`, `spend_tiers_set`, `budget_set`, `team_set_role` and `team_remove_member` now return text (`applied` | `pending`). Their checks and effects are unchanged. The effect itself lives in internal `*_apply` functions.
- **`owner_change_decide(p_org, p_change, p_confirm)`:**
  - only owners, and never the requester;
  - the change must be pending and not expired; otherwise 55000, and an expired change is shown as expired;
  - confirm runs the apply step, which re-validates everything (for example the owner count for tiers);
  - reject marks it rejected;
  - the requester is notified (`owner_change_decided`).
- **`owner_change_cancel(p_org, p_change)`:** only the requester, while it is pending.
- **Errcodes:** 42501, 22023, 55000.
- **Audit:** `owner_change.request`, `owner_change.confirm`, `owner_change.reject` and `owner_change.cancel`, alongside the existing audits for the applied effects.

## Data (migration 0048)
- The `owner_changes` table, with RLS.
- Internal functions: `spend_policy_apply`, `spend_tiers_apply`, `budget_apply`, `team_set_role_apply` and `team_remove_member_apply`. Their bodies are the current setters (0041, 0047, 0045, 0035 and 0035).
- Public wrappers, recreated with a text return type and their grants restored.
- `owner_change_decide` and `owner_change_cancel`.

## Server and UI (apps/web)
- The services pass `applied` / `pending` through: approvals (rule and tiers), budgets, and team (role and remove).
- Forms show "Sent to another owner to confirm." when a change is pending.
- `/approvals` gets a "Settings changes" section. Each change shows what would change, who asked and when it expires, with Confirm / Reject for other owners and Cancel for its author.

## Tests
- **pgTAP (`048_owner_sign_off.test.sql`):**
  - For each kind: loosening with two owners gives `pending` and no effect; confirming by another owner applies it; the requester cannot confirm; reject and cancel work.
  - Tightening applies at once. A single-owner organization applies at once.
  - Expiry: a change older than 7 days cannot be confirmed.
  - A newer request supersedes the older one.
  - Removing or demoting the other owner goes through confirmation, and the target can confirm.
  - Privacy: members and the provider read nothing; there are no direct writes.
  - Suites 035, 041, 045 and 047 stay green, with expectations updated where a setter now returns text.
- **Race:** two owners each request a loosening of a different subject at once; neither applies without the other's confirmation.
- **vitest:** outcome pass-through, the pending wording, and the descriptions of each change.

## Review focus
- Any path to loosen or change owners alone: direct inserts; calling the `*_apply` functions (they must not be executable by users); an owner confirming their own request by superseding; a demote and remove sequence; promoting a second account and confirming with it; an expired or superseded change being confirmed.
- A tightening wrongly classed as loosening (friction) or the reverse (a hole).

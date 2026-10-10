# PAPple approval tiers — design (procurement slice 3)

Status: design approved by the owner in chat on 2026-10-10 ("yes to option 1": tiers of owner approval). Spec and plan reviews are delegated, as for the earlier slices.

## Goal
Large commitments need more than one person. Owners set amount tiers, for example "from 5,000 one owner, from 50,000 two different owners". A contract in a two-owner tier is accepted only when the second, different owner approves.

## Understanding
- **Said:**
  - Tiers have a minimum amount and a number of owner approvals (1 to 3).
  - The highest matching tier decides how many approvals are needed.
  - Each approval is recorded. One rejection ends the request.
  - A change of terms lapses everything collected so far.
  - Pages: a tier editor on `/settings/approvals`, progress on `/approvals` and on the contract.
- **Ruling: an owner's accept counts as the first approval.** Today owners accept directly. If that stayed true for multi-owner tiers, one owner alone could commit 50,000 and the tier would protect nothing. So when the matching tier needs 2 or more, an owner's accept creates or joins the request with that owner's approval recorded, and a different owner must approve. Tiers needing 1 behave exactly as today: owners accept directly, and an admin's request needs one owner.
- **Ruling: tiers live with the approval rule.**
  - They count in the rule's currency and apply only while the rule is on.
  - A contract in another currency uses the highest tier, so the check errs on the safe side.
  - A budget-only request (from slice 2) also takes its approval count from the tiers.
- **Ruling: tiers cannot ask for more owners than exist.**
  - Saving a tier that needs more approvals than the organization has owners is refused.
  - If owners leave later, a request that can no longer collect enough approvals says so on the page. It stays pending: it is never silently downgraded.
- **Success:**
  - No single person can accept a contract in a two-owner tier, even by calling the database directly.
  - Two owners approving at the same moment accept the contract exactly once.
  - Organizations without tiers see no change.

## Non-goals (later)
Named sequential chains (finance, then owner), approvers who are not owners, delegation while away, per-person limits, approval deadlines and reminders.

## Rules
- **`spend_tiers(org_id, min_minor 0..2147483647, approvals 1..3)`**, unique on (org_id, min_minor), at most 10 per organization.
  - Owners replace the whole set with `spend_tiers_set(p_org, p_tiers jsonb)`, which takes `[{"min":…,"approvals":…}]`.
  - It refuses approvals above the current owner count (22023). The change is audited (`spend_tiers.set`).
- **Required approvals** (`spend_required(p_org, p_price, p_currency)`, internal):
  - 1 when the rule is off or no tier matches;
  - otherwise the largest `approvals` among tiers with `min_minor <= price`, in the rule's currency;
  - for another currency, the largest `approvals` of any tier.
- **`spend_requests.approvals_required int not null default 1`** is fixed when the request is made. A pending request is reused only if price, currency, terms, reasons and `approvals_required` all still match. Otherwise it lapses and a new one is made, as today.
- **`spend_approvals(request_id, approver_id, created_at)`**, primary key (request_id, approver_id). Owners and admins of the client organization can read it. There are no direct writes.
- **Accept (client side):**
  - **Admin:** as today. The request carries `approvals_required`.
  - **Owner, required ≥ 2** (the rule is on and the contract meets the threshold or is in another currency):
    - lock order: contract, then the budget lock (when a budget exists), then the request;
    - reuse the matching pending request or create one (reasons `{threshold}`, requested by this owner);
    - record this owner's approval;
    - if enough approvals now exist, accept, otherwise notify the other owners and return `approval_requested`.
  - **Owner, required 1:** as today.
- **Decide:**
  - **Approve:** the terms are checked as today, so changed terms lapse the request.
    - An owner who already approved gets 23505.
    - The requester still cannot decide their own request; for an owner-made request, their accept was already their approval.
    - If the count reaches `approvals_required`, the request is approved, the contract accepted and `approved` returned. Otherwise `partial` is returned, audited as `spend_request.approve_step`, and the requester is told one approval was added.
  - **Reject:** as today, by any owner, at any point.
- **Errcodes:** 42501, 22023, 23505 (already approved), 55000 (no longer pending).

## Data (migration 0047)
- Tables `spend_tiers` and `spend_approvals`, with RLS select for owners and admins and no direct writes.
- Column `spend_requests.approvals_required`.
- Functions `spend_tiers_set` and internal `spend_required`.
- `accept_contract` and `spend_request_decide` are recreated from 0045; their behaviour is otherwise unchanged.

## Server and UI (apps/web)
- **`lib/approvals/service.ts`:**
  - `setTiers` validates: at most 10 rows; amounts in major units are parsed without rounding (as the threshold); approvals 1–3; no duplicate minimums.
  - `decide` accepts the new outcome `partial`.
- **`lib/approvals/present.ts`:**
  - progress text ("1 of 2 owner approvals");
  - who approved and who still can;
  - "cannot be completed: not enough owners";
  - a tier summary;
  - the owner-accept message ("Your approval is recorded. Another owner must approve.").
- **Pages:**
  - the tier editor on `/settings/approvals`, for owners;
  - progress and approvers on `/approvals`;
  - progress in the contract banner.

## Tests
- **pgTAP (`047_approval_tiers.test.sql`):**
  - Tiers: owner-only, validated, capped by the owner count, audited.
  - Required count: tier matching at the edge (`= min`), above the top tier, another currency, rule off.
  - An admin's request needing 2: first owner `partial`, second owner `approved` and the contract accepted, the same owner twice gives 23505, a rejection after one approval ends it, changed terms lapse it.
  - An owner accepting in a two-owner tier gets `approval_requested`, and a second owner accepts it; the first owner cannot approve again.
  - Owners in a one-owner tier accept directly. With no tiers, behaviour is unchanged (suites 041, 042 and 045 stay green).
  - Privacy: the provider and members cannot read approvals.
- **Race:** two owners approve a two-owner request at the same time. The contract is accepted once, with 2 approval rows and the request approved.
- **vitest:** tier input parsing, the `partial` outcome, and the progress wording.

## Review focus
- Any path for one person to accept a multi-owner contract: owner accept, re-accept, approving twice, the requester approving, promotion to owner after requesting.
- Reuse of a pending request after tiers changed.
- Double acceptance under concurrent approvals.
- Lock order (contract, budget lock, request), so no deadlock with `accept_contract`.

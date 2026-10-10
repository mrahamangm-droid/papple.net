# PAPple spend approvals — design (procurement slice 1)

Status: design approved by the owner in chat on 2026-10-10 ("yes"). The owner delegated the choice of feature ("do your best one") and the spec and plan reviews were offered and accepted with that approval.

## Goal
A client organization's owners can require their approval before an admin commits the organization to a contract at or above an amount they set.

## Understanding
- **Said:** spend approvals as the first procurement slice. Owners set a threshold. An admin accepting a contract at or above it creates a request for the owners. Approval covers the exact terms. Everything is audited and notified. Pages: `/settings/approvals`, `/approvals`, and a banner on the contract.
- **Ruling: the checkpoint is the client side's `accept_contract`.** This is where the organization commits to the full price (price is fixed at hire from the proposal; milestones must add up to it). Milestone payments then follow from a contract that is already approved. Gating each payment was considered and rejected: it adds friction and delays the professional's money.
- **Ruling: "exact terms" = price, currency and the milestone schedule.** `set_milestones` already resets both acceptances, so an approval must not survive a schedule change either.
- **Success:** an admin of an organization with a policy cannot make the organization accept a contract at or above the threshold without an owner's approval, even by calling the database directly. An owner approves in one click and the contract is accepted. Organizations without a policy see no change.

## Non-goals (later)
Multi-step or multi-approver chains, per-person spending limits, budgets, gating milestone payments, purchase orders, currency conversion, approval for the provider side, email digests, delegation while away.

## Rules
- **Policy.** One per organization: `enabled`, `threshold_minor` (integer minor units, 0..2147483647) and `currency` (3 uppercase letters). Only owners create, change or switch it off. A new organization has none, which means off.
- **When approval is needed.** The caller accepts for the client side, is an `admin` (not `owner`), the policy is enabled, and either the contract currency differs from the policy currency (no conversion, so this errs on the safe side) or `contracts.price >= threshold_minor`.
- **Owners act directly.** An owner's `accept_contract` behaves as today.
- **Provider side unaffected.** The policy applies only when the organization accepts as the client.
- **Request.** Instead of accepting, the admin's call records a pending request with a snapshot: price, currency and a fingerprint of the milestone schedule (md5 over position, title, amount and due date in position order). It notifies every owner and returns `approval_requested`. One pending request per contract and organization. Calling again while it is pending and unchanged returns `approval_pending`. If the terms changed, the old request becomes `lapsed` and a new one is created.
- **Decision.** Only an owner of the organization decides, and never on a request they made (this covers an admin who was later promoted). Approve: the request is re-checked (contract still `draft`, price, currency and fingerprint unchanged, milestones add up to the price). If valid, it becomes `approved` and the client acceptance is set in the same transaction. If not, the request becomes `lapsed` and the call returns `lapsed` without accepting. Reject needs a note of 1..500 characters. The requester is notified of approve and reject.
- **Withdraw.** The requester or an owner may withdraw a pending request.
- **Policy changes** never touch existing requests. A pending request can still be approved after the policy is switched off; the admin can also simply accept again, which now goes straight through.
- **Statuses:** `pending → approved | rejected | withdrawn | lapsed`. Only `pending` changes.
- **Suspended organizations** already lose `has_org_role`, so they can neither request nor decide.

## Data (migration 0041)
- `spend_policies(org_id pk → organizations, enabled bool, threshold_minor int, currency char(3), updated_by, updated_at)`.
- `spend_requests(id, org_id, contract_id, requested_by, status, price, currency, terms_hash, decided_by, decided_at, note ≤500, created_at)`. Unique partial index on `(org_id, contract_id) where status = 'pending'`. Index on `(org_id, created_at desc)`.
- RLS on, no direct writes. Select: owners and admins of `org_id` (`has_org_role(org_id, array['owner','admin'])`). The provider side never sees the client's policy or requests.
- `spend_terms_hash(p_contract)`: internal, not executable by clients.
- RPCs (SECURITY DEFINER, `search_path = public`, explicit `p_org`, errcodes 42501 not allowed, 22023 invalid, 23505 duplicate):
  - `spend_policy_set(p_org, p_enabled, p_threshold int, p_currency text) → void`. Owner only. Validates the threshold range and the currency format. Audits `spend_policy.set` with before and after.
  - `accept_contract(p_org, p_contract) → text`. Dropped and recreated, because the return type changes from `void` to `text`. Returns `accepted | approval_requested | approval_pending`. Keeps every existing check. Locks the contract row first, so two admins cannot create two requests. Audits `spend_request.create`.
  - `spend_request_decide(p_org, p_request, p_approve bool, p_note text) → text`. Returns `approved | rejected | lapsed`. Locks the request and the contract. Audits `spend_request.approve | reject | lapse`.
  - `spend_request_withdraw(p_org, p_request) → void`. Audits `spend_request.withdraw`.
- Notifications (existing `notify`): `spend_approval_requested` to each owner, and `spend_request_approved` / `spend_request_rejected` to the requester. The payload holds only `contract_id` and `request_id`; amounts never go into notifications.

## Server and UI (apps/web)
- `lib/approvals/validators.ts` (zod): policy input with a major-unit amount converted with the existing money helpers, decide input, withdraw input.
- `lib/approvals/db.ts`: typed RPC wrappers using `mapDbError`.
- `lib/approvals/service.ts`: `createApprovalActions(deps)`. Flow per action: parse → authenticate → throttle (new rule `approvals`, 30/min per user) → RPC → revalidate. Result `{ok:true, outcome?}` or `{ok:false, code}` with code in `forbidden | invalid | duplicate | rate | error`.
- `lib/approvals/present.ts`: status labels, `policyApplies` (for display only; the database decides), notification copy and links (`/approvals`, or the contract).
- `lib/contracts/db.ts`: `acceptContract` returns the outcome string. `lib/contracts/actions.ts` passes it through as `outcome`. `ContractButtons` shows "Sent to your owners for approval" when the outcome is not `accepted`.
- Pages:
  - `/settings/approvals?org=`: owners edit the policy; admins see it read-only.
  - `/approvals?org=`: pending requests first (contract title, price, requester, age, and Approve / Reject with a note for owners; Withdraw for the requester), then the last 50 decided requests.
  - Contract page banner for the client org's owners and admins while a request is pending: "Awaiting owner approval".
- Navigation: "Approvals" for owners and admins.
- Notifications page: the new types use the approvals copy.
- No public, SEO or API changes. Pages are signed-in only (the existing proxy protects `(app)`).

## Tests
- **pgTAP (`041_spend_approvals.test.sql`):**
  - Policy: owner sets it; admin, member, outsider and provider org refused; invalid threshold or currency refused.
  - Accept without a policy, by an owner, below the threshold, or on the provider side → `accepted`.
  - Admin at or above the threshold, or in another currency → `approval_requested`, contract not accepted, owners notified. A repeat call → `approval_pending`.
  - Terms change → the old request lapses and the next accept creates a new one.
  - Decisions: admin, member, outsider and the requester-turned-owner cannot decide. The owner approves → accepted. Approve after a milestone change or after cancellation → `lapsed` and not accepted. Reject without a note refused; reject with a note works. Withdraw by the requester and by an owner; withdraw by another admin refused.
  - Access: no direct writes, the provider org cannot read, admins read, audit rows written.
- **Race:** two parallel admin accepts create one request.
- **vitest:** validators, service (gates, rate limit, error mapping, outcome pass-through), presenters (labels, notification copy without amounts), contracts actions outcome.
- **e2e:** anonymous visitors to `/approvals` and `/settings/approvals` are sent to sign-in.

## Review focus
- An admin getting acceptance without approval: a direct `accept_contract` call, a race, or a terms change after approval.
- Self-approval through promotion.
- The provider side reading the client's policy.
- Amounts leaking into notifications or email.
- The lapse check missing a milestone edit.
- The return type change breaking callers: only `lib/contracts/db.ts` calls it.

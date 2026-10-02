# PAPple — Sub-project 3: Contracts, Milestone Payments, Reviews, Disputes — Design

Date: 2026-10-02 · Status: implemented on `feat/contracts-payments` (see `docs/acceptance-subproject-3.md`); executed on the owner's "please do it for me" without a separate spec review · Builds on: foundation and marketplace-core specs · Related ADR: `docs/adr/0002-stripe-connect-express.md`

## 1. Purpose and success criteria

Turn a shortlisted proposal into paid, reviewed work without Papple ever holding customer funds.

Success = this journey works, with isolation and money invariants proven by database tests:

Client hires from a shortlisted proposal → contract with milestones is agreed → professional completes Stripe onboarding → contract goes active → professional submits a milestone → client approves and pays → money settles to the professional minus commission → contract completes → both sides review. Either side can raise a dispute that freezes payments.

Out of scope: hourly contracts and timesheets, refunds and chargebacks, tax/VAT invoicing (SP8), Admin console screens and dispute rulings (SP4), deposit or fund-upfront payments, AI features (SP6).

## 2. Owner decisions (from this brainstorm)

1. **Payment flow:** pay per milestone on client approval. A Stripe Checkout session creates a destination charge to the professional's connected account. Papple holds no balance.
2. **Reviews and disputes:** two-way reviews plus a basic dispute record that freezes payments and feeds an Admin queue (screens in SP4).
3. **Contract type:** fixed price with milestones only.

Carried from earlier decisions: Stripe Connect Express with destination charges; launch commission 5% Professional + 2% Client, already seeded as `commission.professional_bps=500` and `commission.client_bps=200` in `platform_settings`; all amounts are Admin-configurable data.

## 3. Approaches considered

**Payment timing.** (A) Pay on approval, chosen. (B) Fund upfront and release on approval: gives the professional a guarantee but risks Papple being treated as holding funds and needs legal and Stripe confirmation. (C) One payment at completion: too coarse. **Cost of A:** the professional works before being paid; mitigated by a visible notice and a later optional deposit milestone.

**Payment provider boundary.** All Stripe calls sit behind one `PaymentProvider` interface (create checkout session, verify webhook, read account status). Tests use a fake. A second provider or a Stripe API change touches one file.

**Source of truth for "paid".** Only the verified webhook marks a milestone paid, never the browser redirect. Events are stored in the existing `webhook_events` table by event id for idempotency.

## 4. Data model (migrations `0015` and following)

All tables: RLS on, default deny, money as integer minor units plus ISO currency, UTC timestamps, covered by `check-rls-coverage`.

| Table | Purpose | Key rules |
|---|---|---|
| `connected_accounts` | `org_id` unique, `stripe_account_id`, `payouts_enabled`, `details_submitted`, `updated_at` | Org owner/admin of the provider org reads; written only by the webhook/service path. Stripe account id never exposed to the other party. |
| `contracts` | `project_id`, `proposal_id` unique, `client_org_id`, `provider_org_id`, `title`, `price`, `currency`, `commission_pro_bps`, `commission_client_bps` (snapshot at hire), `status` (`draft`/`active`/`completed`/`cancelled`/`disputed`), `created_by` | Visible only to the two orgs' members and platform admins. Commission rates are snapshotted so later Admin changes never alter an existing contract. |
| `milestones` | `contract_id`, `position`, `title`, `description`, `amount`, `due_date`, `status` (`pending`/`submitted`/`changes_requested`/`approved`/`paid`) | Sum of amounts must equal contract price before `active` (enforced in the activation RPC under a lock). Unique `(contract_id, position)`. |
| `payments` | `milestone_id` unique, `checkout_session_id`, `payment_intent_id`, `amount`, `client_fee`, `provider_fee`, `currency`, `status` (`pending`/`succeeded`/`failed`), `paid_at` | Read by both orgs; written only by webhook/service path. One successful payment per milestone, enforced by unique constraint. |
| `reviews` | `contract_id`, `author_org_id`, `subject_org_id`, `rating` 1–5, `comment` ≤ 2,000 chars, `published_at` | Unique `(contract_id, author_org_id)`. Hidden until both have posted or the wait (setting `reviews.reveal_after_days`, default 14) passes. Only after the contract is `completed`. |
| `disputes` | `contract_id`, `raised_by_org_id`, `reason` ≤ 2,000 chars, `status` (`open`/`resolved`), `opened_at` | One open dispute per contract. Visible to both orgs; platform admin/support reads and resolves (RPC provided here, screens in SP4). |

**Views.** `public_provider_ratings` exposes only aggregate rating and count per provider org for public profile pages. No author, no comment text of unpublished reviews.

**Settings (data, not code):** `commission.professional_bps`, `commission.client_bps` (exist), plus `payments.min_application_fee_minor` (floor so Stripe fees are covered), `reviews.reveal_after_days`, `contracts.max_milestones`, `payments.checkout_expiry_minutes`. Launch values are placeholders for owner confirmation.

## 5. Behaviour

**Hire.** Client org owner/admin calls `create_contract(p_org, p_proposal)`. Requires proposal `shortlisted`, project open, caller in the client org. Sets proposal status to `hired` and the project to `closed`. Locks per proposal to prevent double hire.

**Milestones.** Either side proposes milestones while the contract is `draft`; both orgs must `accept_contract`. `activate_contract` verifies the amounts sum to the price, the milestone count is within the limit, and the provider's connected account has `payouts_enabled`; otherwise it fails with a clear error.

**Submit and approve.** Provider calls `submit_milestone`. Client calls `approve_milestone` (creates the payment record and returns the Checkout session) or `request_changes`. Approval is idempotent per milestone under an advisory lock, so double-clicks and retries never create two charges.

**Money math (pure, tested function).** `client_fee = round(amount × client_bps / 10000)`, `provider_fee = round(amount × pro_bps / 10000)`, client pays `amount + client_fee`, `application_fee = client_fee + provider_fee` with the configured floor, provider receives `amount − provider_fee` (less Stripe's processing fee falling on the platform; see risks). Rounding is half-up and the three numbers always add up exactly.

**Webhook.** `POST /api/webhooks/stripe` verifies the signature, records the event id, and applies `checkout.session.completed`, `payment_intent.payment_failed`, and `account.updated`. Replays are ignored. Unknown events are acknowledged and logged.

**Completion.** When the last milestone is `paid`, the contract becomes `completed` and review prompts are created as notifications.

**Disputes.** `raise_dispute` is allowed on `active` contracts by either org. It sets the contract `disputed`, blocks `approve_milestone` and new Checkout sessions, and creates an Admin queue row. `resolve_dispute` (platform admin, MFA aal2, audited) returns the contract to `active`, completes it, or cancels it. Money already settled is not clawed back here.

**Notifications.** In-app for: contract offered, milestone submitted, payment received, dispute raised, review requested. Email follows the existing flagged notifier.

## 6. Security and privacy

- Every table has RLS tests for anonymous, stranger, same-org member by role, other-org member, platform admin.
- All writes through SECURITY DEFINER RPCs with fixed search_path, explicit `p_org`, re-checked roles, and the errcode scheme already used (42501, 22023, 54000, 23505).
- Webhook signature verification, replay protection, and a strict allowlist of event types. The Stripe secret and webhook secret live in the secret store only; none are logged.
- Rate limits: checkout creation, dispute, review, contract actions.
- Cross-tenant tests include: client of another org cannot approve; provider cannot approve own milestone; stranger cannot read a contract or payment.
- Race tests: concurrent approve of one milestone yields one payment; concurrent hire of one proposal yields one contract.
- Admin actions use the audited wrapper and aal2.

## 7. UI surface

Signed-in: `/contracts` (list), `/contracts/[id]` (milestones, status, pay button for client, submit button for provider, dispute and review actions), hire button on the proposals list, `/settings/payouts` for Stripe onboarding status and link. Public: aggregate rating on `/p/[slug]`. Uses the existing UI kit and `navFor`.

## 8. Testing and verification

- **DB (pgTAP):** isolation matrix, sum-of-milestones rule, one-payment-per-milestone, dispute freeze, review reveal rules, snapshot commission, view whitelist, mutation check, race harness cases.
- **Unit (Vitest):** money math (rounding, floor, JPY/KWD exponents, sums add up), payment-provider adapter with a fake client, webhook handler idempotency and signature rejection, state-machine guards.
- **E2E:** anonymous rating display and gated-route redirects. Authenticated flows are NOT VERIFIED until real accounts exist.
- **Acceptance record** `docs/acceptance-subproject-3.md` with the same VERIFIED / NOT VERIFIED table.

## 9. Known gaps and risks (stated up front)

1. **Professional works before being paid.** Inherent to pay-on-approval. Mitigated by a visible notice; a deposit milestone is a later option.
2. **Stripe processing fees fall on the platform account** for destination charges, so the 5% + 2% must cover them. The fee floor setting guards small amounts; owner must confirm the numbers.
3. **Stripe Connect availability** for a UAE platform and each professional's country is unverified until a live Stripe account exists. Built and tested against test mode and mocks only.
4. **Real Stripe webhooks, Checkout, and onboarding** are NOT VERIFIED until owner accounts exist.
5. **Refunds, chargebacks, VAT/tax invoices** are not handled; disputes do not move money.
6. **Currency:** one currency per contract. Cross-currency conversion is not supported.
7. Seed values are placeholders pending owner confirmation.

## 10. Build order inside this sub-project

1. Settings seeds and money math. 2. Connected accounts and webhook plumbing. 3. Contracts and milestones with RPCs. 4. Payments and checkout. 5. Disputes. 6. Reviews and rating view. 7. Notifications. 8. UI pages. 9. Race tests, e2e, acceptance record.

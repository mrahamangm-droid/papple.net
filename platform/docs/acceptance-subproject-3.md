# Sub-project 3 (Contracts, milestone payments, reviews, disputes) — acceptance record

Run date: 2026-10-02 · Branch: `feat/contracts-payments` (built on `feat/marketplace-core`). The spec and plan were executed on the owner's "please do it for me" without a separate written review.
Legend: **VERIFIED** = observed passing in this session · **PARTIAL** · **NOT VERIFIED** = needs the owner's accounts, a live service or real data. Nothing marked NOT VERIFIED may be assumed to work.

## Evidence run (fresh, after the review fix pass)
| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint src` | 0 errors, 1 warning (pre-existing MFA full-page navigation) |
| Vitest | 41 files, 381 tests passed |
| `scripts/db-test.sh` | 398 assertions passed; RLS coverage OK |
| `scripts/db-race-test.sh` | passed (one hire per project, one payment per milestone, one webhook success with seven duplicate deliveries flagged) |
| `next build` without secrets | success |
| Playwright (real Chromium, desktop + Pixel 7) | 60 passed |

## Mutation checks
1. Removing the row locks in `record_payment_succeeded` → 3 race checks FAILED. Restored → green.
2. Removing the compare-and-set condition in `attach_checkout_session` → 2 pgTAP assertions FAILED. Restored → 397 passed.

## Journey (spec §1)
Hire from a shortlisted proposal → milestones agreed by both sides → professional's Stripe onboarding → contract active → submit → client approves and pays → money settles minus commission → contract completes → both review. Either side can raise a dispute that freezes approvals.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Hire, one live contract per project, no self-deal | **VERIFIED (local)** | pgTAP + race harness; hiring or approving through a second organization the same person belongs to is refused. |
| 2 | Milestones, sum equals price, acceptance by both sides | **VERIFIED (local)** | pgTAP (015, 016). |
| 3 | Commission snapshot, fee math (half-up, floor, JPY/KWD exponents) | **VERIFIED (unit + pgTAP)** | `computeMilestoneCharge` and SQL agree on the tested cases. See gap 4 on the fee floor. |
| 4 | Only the verified webhook marks a payment paid; amount and currency checked; replays idempotent | **VERIFIED (unit + pgTAP + race)** | Real Stripe signing library with generated test headers; forged and unsigned requests refused (e2e). **NOT VERIFIED:** a real Stripe event. |
| 5 | No double payment on retry | **VERIFIED (unit + pgTAP)** | Retry expires the old session and refuses to open another if it was already paid; session attach is a compare-and-set; the expiry of a replaced session cannot fail the new attempt. **NOT VERIFIED:** Stripe's actual behaviour when expiring a paid session. |
| 6 | Disputes freeze approvals; staff + aal2 resolve, audited | **VERIFIED (local)** | pgTAP (018). |
| 7 | Blind two-way reviews, public aggregate rating | **VERIFIED (local)** | pgTAP; reviews close once the other side's is visible; the view exposes only slug, average and count. |
| 8 | Contract, payout and review pages | **PARTIAL** | Pure logic unit-tested (`present.ts`); pages typecheck and build. **NOT VERIFIED:** any signed-in flow end to end (needs live Supabase Auth). |
| 9 | Real Stripe: Connect availability for a UAE platform and the professional's country, Checkout, onboarding, webhooks | **PARTIAL (docs read 2026-10-02) / NOT VERIFIED (live)** | Stripe's Express documentation says UAE platforms cannot self-serve Express accounts (contact Stripe sales), and may only onboard UAE-based Express accounts, with destination charges (not `on_behalf_of`) or separate charges and transfers. The test sandbox "Papple Mart" is connected read-only: it has no connected accounts and no webhook endpoints yet. Checkout, onboarding and webhook delivery remain untested. Platform and Connect events use separate secrets. |
| 10 | Whether 5% + 2% covers Stripe's processing fees | **PARTIAL (arithmetic on Stripe's published UAE rates, 2026-10-02) / NOT VERIFIED (your contract)** | The platform takes 7% of the milestone (2% client + 5% professional). Stripe's published UAE card rate is 2.9% + AED 1.00 on the amount the client pays (1.02 x milestone), plus 1% for international cards and 1% for currency conversion. Domestic margin is about 4.0% of the milestone minus AED 1; international about 3.0%; international with conversion about 2.0%. If Stripe puts the platform on its "you handle pricing" model there is also AED 7.50 per active account per month and 0.25% + AED 5.50 per payout. Break-even milestone: about AED 25 domestic, 50 worst case, 171 to 371 with payout fees. The fee floor is now seeded at 100 minor units (AED 1.00) and a minimum milestone of 10000 minor units (AED 100, setting `contracts.min_milestone_minor`) is enforced in `set_milestones`; both are placeholders for you to confirm. Refunds do not return Stripe's fee and each dispute costs AED 60. Rates are from Stripe's public pages, not from your contract. |

## Independent review (fresh reviewer, most capable model) and fixes
Findings: 1 Critical, 4 Important, 7 Minor. Each fix has a test that failed first.
1. **Critical, double charge on "Retry payment"** (expiry failure swallowed, then a second session opened) → `expireCheckout` reports `complete`, the action refuses; attach is a compare-and-set; the success redirect no longer offers a retry.
2. **Important, a replaced session's expiry failed the new attempt** → failure events are scoped to the current session; a fresh attach revives a payment failed by a stale event.
3. **Important, approving or reviewing as someone on both sides** → refused in `approve_milestone` and `post_review`.
4. **Important, blind reviews could be answered after reveal** → refused once the other side's review is visible.
5. **Important, `account.updated` arrives on a separate Connect endpoint secret** → second signing secret supported (`STRIPE_CONNECT_WEBHOOK_SECRET`).

## Known gaps (stated up front)
1. Refunds, chargebacks, VAT/tax invoices and hourly contracts are out of scope; a duplicate charge is flagged and audited but not refunded.
2. Payout onboarding status is only updated by the `account.updated` webhook; the payouts page does not re-read the account from Stripe, and an out-of-order delivery could briefly show older state.
3. Review minors deferred: two simultaneous onboarding clicks can create an orphan Stripe account; checkout can open after a dispute is raised between approval and session creation; the fee floor is not snapshotted at hire and ignores currency exponent, and below Stripe's minimum charge a milestone can never be paid; amounts near 2^31 overflow; an impossible calendar date gives a generic error; `set_milestones` locks in the reverse order from the documented one on draft contracts; public ratings count reviews an agency received as a client.
4. Seed values (fee floor, expiry, reveal days, milestone cap) are placeholders pending owner confirmation.

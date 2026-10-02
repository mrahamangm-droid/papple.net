# Sub-project 4 (Admin dispute queue, rulings, refunds) — acceptance record

Run date: 2026-10-02 · Branch: `feat/admin-disputes` (built on `feat/contracts-payments`). The spec and plan were executed on the owner's "what is best for the platform, please continue" without a separate written review.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs the owner's accounts, a live service or real data. Nothing marked NOT VERIFIED may be assumed to work.

## Requirements
| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Only platform staff with a second factor can rule; note 10-1,000 characters; a dispute is ruled once | **VERIFIED (pgTAP)** | `020_rule_dispute.test.sql` |
| 2 | `resume`, `complete`, `cancel` never touch payments | **VERIFIED (pgTAP + unit)** | `020`, `disputes/actions.test.ts` |
| 3 | `refund_cancel` cancels the contract and queues one full refund per succeeded payment; pending payments are untouched | **VERIFIED (pgTAP)** | `020` |
| 4 | One refund per payment, deterministic idempotency key, amount read from the database | **VERIFIED (pgTAP + unit)** | `019`, `020`, `refunds.test.ts` |
| 5 | A Stripe failure never loses the ruling; Retry repeats only pending refunds | **VERIFIED (unit)** | `refunds.test.ts`, `disputes/actions.test.ts` |
| 6 | The refund webhook finalizes once, checks amount and currency, replays are no-ops | **VERIFIED (unit + pgTAP)** | `webhook-handler.test.ts`, `020` |
| 7 | Admin screens: queue (oldest first), detail, ruling form, Retry; signed-out users are redirected | **VERIFIED (unit + e2e anonymous)** | `disputes/present.test.ts`; Playwright anonymous checks; `next build` |
| 7b | A late paid session cannot flip a refunded or refunding payment back to succeeded; a second charge is flagged; money on a cancelled contract is reported | **VERIFIED (pgTAP + unit)** | `021_late_payments.test.sql`, `webhook-handler.test.ts` |
| 7c | Retry and rulings require aal2 in the server action as well as the database | **VERIFIED (unit)** | `disputes/actions.test.ts` |
| 8 | A real refund through Stripe with transfer reversal | **NOT VERIFIED** | Needs Stripe Connect enabled for the platform and a paid test charge |
| 9 | The refund events arrive at the webhook | **NOT VERIFIED** | The Stripe endpoint currently subscribes to four checkout events; add `refund.created` and `refund.updated` |
| 10 | The signed-in admin screens in a browser (queue, ruling, confirm dialog) | **NOT VERIFIED** | Needs an admin account with MFA |

## Deferred
- A Checkout session left open when a refund ruling cancels the contract can still complete. It is now recorded (the money moved), audited as `payment.on_cancelled_contract` and raised as a `paid_on_cancelled` alert, but the refund must be issued by hand in Stripe: nothing queues it automatically.
- Retry re-sends refunds Stripe already accepted until the webhook finalizes them (harmless through the idempotency key).
- The dispute page shows no message thread (messages are not linked to contracts).
- Only the `admin` platform role can rule through the screen; `support` staff are refused by the admin wrapper.
- Partial or split refunds, chargebacks and the wider Admin console are out of scope.

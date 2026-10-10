# Paid bookings (bookings slice 2) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes"): payment after the professional confirms, a 24-hour payment window and a 24-hour client refund cut-off. Spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Stripe (test mode), Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Price per service (1 to 10,000,000 minor units, or empty for free), set by owners and admins only, and only with finished payout setup; anyone can read the price of a listed service | **VERIFIED (pgTAP)** | `044_paid_bookings.test.sql` |
| 2 | A request snapshots price, currency and both commission rates; later setting changes do not affect it | **VERIFIED (pgTAP)** | same |
| 3 | Confirming a priced booking needs payout setup and sets `pay_by = least(now + window, start - 1 hour)` | **VERIFIED (pgTAP)** | same |
| 4 | Pay: client owners, admins and members only; confirmed, inside the window, not already paid; fee math as contracts (half-up rounding, minimum fee); one payment row per booking; the previous session is returned so it is expired first | **VERIFIED (pgTAP)** | same |
| 5 | Checkout: attach is compare-and-set, a session already paid is never answered with a second checkout, a lost race expires its own session; the session never outlives the window when the window is 30 minutes or more | **VERIFIED (pgTAP + unit)** | `lib/bookings/payments.test.ts` |
| 6 | Webhook routing inside the database: matching amount records the payment, a wrong amount is refused (`mismatch`), replays are `duplicate`, a second charge is `duplicate_charge`, a stale session cannot fail it; contract payments keep their old path (suites 015-021 unchanged and green) | **VERIFIED (pgTAP)** | `044`, `015`-`021` |
| 7 | Refunds: the professional cancelling always refunds in full; the client cancelling exactly at the cut-off is refunded, one minute later is not; an unpaid booking cancels without money; the refund carries a fixed idempotency key; the refund webhook must match amount and currency | **VERIFIED (pgTAP)** | same |
| 8 | An unpaid booking past its window frees the slot at once and is released (cancelled, with a reason) on the next request, pay or list; money arriving after release is recorded, the booking stays cancelled, a full refund is queued and the outcome is alerted | **VERIFIED (pgTAP)** | same |
| 9 | Six parallel pay calls leave one payment row; six parallel webhook deliveries record the payment once | **VERIFIED (race)** | `scripts/db-race-test.sh` case 25 |
| 10 | Privacy: Stripe session, intent and refund ids and failure reasons are not readable by users; a third organization sees nothing; no direct writes; the service-role functions are not callable by users; Retry refund is allowed only for owners, admins and members of either side | **VERIFIED (pgTAP)** | same |
| 11 | Price input parsing refuses extra decimals instead of rounding; presenter payment states; error mapping; admin console edits both new settings within range | **VERIFIED (unit)** | `lib/bookings/*.test.ts`, `lib/admin/*.test.ts` |
| 12 | Pages still refuse signed-out visitors; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | `e2e/bookings-anonymous.spec.ts` |
| 13 | End to end with Stripe test mode: set a price, request, confirm, pay with a test card, see "Paid", cancel early and see "Refunded" | **NOT VERIFIED** | Needs Stripe test keys and the webhook endpoint on staging, plus two accounts |

## Known limits
- Full refunds only; no partial refunds, deposits, coupons or per-professional cancellation policies.
- Release of unpaid bookings is lazy (there is no scheduler): the slot is free for others immediately, and the status changes the next time either side lists bookings or someone requests that professional.
- A refund that fails to send stays "Refund pending" with a **Retry refund** button for either side. A refund queued by a late payment (paid after release) is sent when someone presses that button; the webhook outcome is alerted so an operator can also act.
- No booking invoices; the Stripe receipt is the record.
- If the payment window is shorter than 30 minutes (Stripe's minimum session length), a payment can land after it; that payment is refunded in full automatically.

## Review fixes applied
(filled in after the independent review)

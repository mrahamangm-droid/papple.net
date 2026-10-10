# Paid bookings (bookings slice 2) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes"): payment after the professional confirms, a 24-hour payment window and a 24-hour client refund cut-off. Spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Stripe (test mode), Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Price per service (1 to 10,000,000 minor units, or empty for free), set by owners and admins only, and only with finished payout setup; anyone can read the price of a listed service | **VERIFIED (pgTAP)** | `044_paid_bookings.test.sql` |
| 2 | A request snapshots price, currency and both commission rates; later setting changes do not affect it | **VERIFIED (pgTAP)** | same |
| 3 | Confirming a priced booking needs payout setup and sets `pay_by = least(now + window, start - 1 hour)`; refused when that leaves under 30 minutes (Stripe's shortest session) | **VERIFIED (pgTAP)** | same |
| 4 | Pay: client owners, admins and members only; confirmed, at least 30 minutes before the deadline, not already paid, price above the minimum fee; fee math as contracts (half-up rounding, minimum fee); one payment row per booking; the previous session is returned so it is expired first | **VERIFIED (pgTAP)** | same |
| 5 | Checkout: attach is compare-and-set, a session already paid is never answered with a second checkout, a lost race expires its own session; the session never outlives the window when the window is 30 minutes or more | **VERIFIED (pgTAP + unit)** | `lib/bookings/payments.test.ts` |
| 6 | Webhook routing inside the database: matching amount records the payment, a wrong amount is refused (`mismatch`), replays are `duplicate`, a second charge is `duplicate_charge`, a stale session cannot fail it; contract payments keep their old path (suites 015-021 unchanged and green) | **VERIFIED (pgTAP)** | `044`, `015`-`021` |
| 7 | Refunds: the professional cancelling always refunds in full; the client cancelling exactly at the cut-off is refunded, one minute later is not; an unpaid booking cancels without money; the refund carries a fixed idempotency key; the refund webhook must match amount and currency | **VERIFIED (pgTAP)** | same |
| 8 | An unpaid booking past its window frees the slot and is released (cancelled, with a reason) on the next request or list; with a checkout open the time is held one more hour; a webhook for a booking still confirmed counts as paid; money arriving after cancellation or release is recorded, the booking stays cancelled, a full refund is queued, sent by the webhook and alerted; no checkout attaches to a booking that is no longer payable, and cancelling expires an open one | **VERIFIED (pgTAP)** | same |
| 9 | Six parallel pay calls leave one payment row; six parallel webhook deliveries record the payment once; a payment committed while a release waits on the booking keeps the booking (fails on the pre-fix migration) | **VERIFIED (race)** | `scripts/db-race-test.sh` cases 25 and 26 |
| 10 | Privacy: Stripe session, intent and refund ids and failure reasons are not readable by users; a third organization sees nothing; no direct writes; the service-role functions are not callable by users; Retry refund is allowed only for owners, admins and members of either side | **VERIFIED (pgTAP)** | same |
| 11 | Price input parsing refuses extra decimals instead of rounding; presenter payment states; error mapping; admin console edits both new settings within range | **VERIFIED (unit)** | `lib/bookings/*.test.ts`, `lib/admin/*.test.ts` |
| 12 | Pages still refuse signed-out visitors; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | `e2e/bookings-anonymous.spec.ts` |
| 13 | End to end with Stripe test mode: set a price, request, confirm, pay with a test card, see "Paid", cancel early and see "Refunded" | **NOT VERIFIED** | Needs Stripe test keys and the webhook endpoint on staging, plus two accounts |

## Known limits
- Full refunds only; no partial refunds, deposits, coupons or per-professional cancellation policies.
- Release of unpaid bookings is lazy (there is no scheduler): the slot is free for others once lapsed, and the status changes the next time either side lists bookings or someone requests that professional.
- A refund that fails to send stays "Refund pending" with a **Retry refund** button for either side. Stripe remembers a failed idempotent request for 24 hours, so a retry within that time returns the same error (same as contract refunds; never a double refund, the amount is always the full payment).
- No booking invoices; the Stripe receipt is the record.
- A booking starting within about 90 minutes cannot be confirmed as paid (the client needs at least 30 minutes to pay, ending 1 hour before the start).
- Stripe's own smallest charge (for example 0.50 USD) is not checked when the price is set; a smaller price fails at checkout with a generic error.
- The local test database does not model Supabase's default function grants to `service_role`; the internal booking functions are harmless if called that way.

## Review fixes applied (independent review, same migration 0044, before merge)
- **Blocking:** a release that waited on the booking row while the webhook recorded a payment cancelled a paid booking without a refund. The release now locks candidates and re-checks in a new statement; race case 26 reproduces the old failure.
- A client who paid in time could lose the booking when the webhook arrived late: a booking still confirmed now counts as paid, an open checkout holds the time an extra hour, and pay or confirm need 30 minutes so a session never outlives the deadline.
- A cancelled booking's open checkout stayed payable: attaching is refused once the booking is no longer payable, and cancelling expires the open session.
- Refunds for money that arrived after cancellation are now sent by the webhook, not only by Retry refund.
- A price at or below the minimum fee (the professional would receive nothing) is refused, when set and again when paying.
- `booking_pay` no longer tries to release (the raise rolled it back, and it could deadlock with a listing).
- The list shows what the client is charged and refunded (price plus client fee); the professional also sees its own price.
- `cancel()` returns the validated booking id instead of the action casting its raw input.

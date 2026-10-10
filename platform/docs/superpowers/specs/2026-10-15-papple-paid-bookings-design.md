# PAPple paid bookings — design (bookings slice 2)

Status: design approved by the owner in chat on 2026-10-10 ("yes"): payment after the professional confirms, with a 24-hour payment window, and a 24-hour client cancellation cut-off for refunds. The spec and plan reviews are delegated, as for the earlier slices.

## Goal
A professional can charge for a booked session. The client pays through Stripe Checkout after the professional confirms. The money goes to the professional's connected account, and Papple keeps its usual commission. Cancellations refund according to a simple, fixed rule.

## Understanding
- **Said:**
  - A price per service, set on the booking settings page. Empty means free (slice 1 behaviour).
  - Charging requires finished payout setup, as for contracts.
  - Commission rates come from the existing contract settings.
  - The client pays after confirmation, within 24 hours or by 1 hour before the start, whichever is earlier. Otherwise the slot is released.
  - Refunds: the professional cancels → full refund; the client cancels ≥ 24 hours before → full refund; later → none. The cut-off is a platform setting.
  - Only the verified webhook marks a booking paid. Amount and currency must match, and a double click cannot open two checkouts.
- **Ruling: route booking payments inside the database.**
  - Stripe metadata keeps `payment_id`.
  - `record_payment_succeeded`, `record_payment_failed` and `record_refund_succeeded` first check whether the id is a booking payment and delegate if so.
  - The webhook code, its signature check and its once-per-event store stay as they are.
  - Cost if wrong: the three functions are recreated with their bodies otherwise unchanged.
- **Ruling: release unpaid bookings lazily.** A confirmed but unpaid booking whose `pay_by` has passed counts as free for slots right away. It is set to `cancelled` (reason "Payment was not received in time") the next time anyone requests that provider, tries to pay, or lists bookings. There is no scheduled job; this repo has no cron scheduler configured.
- **Ruling: refunds are sent by the cancel action, with a "Retry refund" button.** There is no cron job. Every refund has a deterministic idempotency key, so a retry never refunds twice.
- **Ruling: money that arrives after a booking was cancelled or released is refunded automatically.** The payment is recorded (it is real), a full refund is queued, and the outcome `paid_on_cancelled` is alerted, the same alert path as contracts.
- **Success:**
  - A client pays a confirmed booking once, even with double clicks.
  - The professional gets paid minus the fee.
  - A late or refundable cancellation does exactly what the table says.
  - No state changes without a verified webhook, including payments for the wrong amount.

## Non-goals (later)
Partial refunds, per-professional cancellation policies, deposits, coupons, invoices for bookings, payment at request time, reminders before `pay_by`, a scheduled release job.

## Rules
- **Price:** `services.booking_price` (int minor units, 1..10,000,000) or null, in the service's `currency`. It is set by the provider org's owners and admins, only when the org's connected account has `payouts_enabled`.
- **Snapshot at request:** for a priced service, the booking stores `price`, `currency`, `commission_pro_bps` and `commission_client_bps` (from settings, as `create_contract` does). Later price or commission changes never affect an existing booking.
- **Confirm (priced bookings):**
  - Needs `payouts_enabled` for the provider org (else 22023 "finish payout setup first").
  - Sets `confirmed_at = now()` and `pay_by = least(now() + payment_window_hours, starts_at - 1 hour)`.
  - If `pay_by <= now()`, the booking is too close to its start to be paid, so confirming is refused (22023).
- **Pay (client org owners, admins or members):**
  - The booking must be confirmed, priced, `now() < pay_by`, and not already paid.
  - The fee math is the same as `approve_milestone`: `client_fee = round_half_up(price × client_bps / 10000)`, `provider_fee` likewise, `client_total = price + client_fee`, `application_fee = least(greatest(client_fee + provider_fee, payments.min_application_fee_minor), client_total)`.
  - Creates or refreshes the `booking_payments` row (one per booking) and returns `previous_session`, so the server expires a stale session first. Checkout attach is compare-and-set, as for contracts.
- **Webhook:**
  - `payment_succeeded` for a booking payment: when amount and currency match `client_total`, mark it succeeded and notify the provider org (`booking_paid`). On a mismatch, return `mismatch` (alerted).
  - If the payment was already succeeded, refund-pending or refunded, return `duplicate` for the same intent and `duplicate_charge` for another.
  - If the booking is cancelled, or confirmed with `pay_by` passed, record the payment, set the booking cancelled with reason "Paid after the booking was released", queue a full refund, and return `paid_on_cancelled`.
  - `payment_failed` affects only the current session. `refund_succeeded` finalizes the refund, and `amount` and `currency` must match.
- **Cancel:**
  - Unchanged rules for who and when.
  - On a **paid** booking it queues a full refund when the canceller is the provider org, or when it is the client org and `starts_at - now() >= client_refund_cutoff_hours`. Otherwise there is no refund.
  - Returns `cancelled | refund_pending`.
  - The other org's notification is unchanged. The cancelling user sees the refund outcome on the page.
- **Settings:** `bookings.payment_window_hours` (default 24, 1..168) and `bookings.client_refund_cutoff_hours` (default 24, 0..720), both in `platform_settings` and editable in the existing admin settings screen.

## Data (migration 0044)
- `services.booking_price int null check (booking_price between 1 and 10000000)`.
- `bookings` gains `price int null`, `currency text null`, `commission_pro_bps int null`, `commission_client_bps int null`, `confirmed_at timestamptz null` and `pay_by timestamptz null`.
- `booking_payments(id, booking_id unique, amount, client_fee, provider_fee, client_total, application_fee, currency, status pending|succeeded|failed|refund_pending|refunded, checkout_session_id, payment_intent_id, paid_at, created_at)`. RLS select for members of either org, through a column grant that excludes session and intent ids.
- `booking_refunds(id, booking_payment_id unique, amount, currency, status pending|succeeded, provider_refund_id, idempotency_key unique, failure_reason, created_at, updated_at)`. Select for members of either org, without provider ids or the failure reason.
- RPCs, for signed-in users:
  - `service_set_booking_price(p_org, p_service, p_price)`;
  - `booking_pay(p_org, p_booking) returns jsonb`;
  - `booking_cancel` is recreated to return text;
  - `booking_decide` and `booking_request` are recreated with the payment rules;
  - `booking_list` is recreated with `price`, `currency`, `pay_by` and `payment_status`, plus `refund_status`.
- Service role only:
  - `booking_payment_destination(p_payment) returns text`;
  - `booking_attach_checkout(p_payment, p_session, p_prev) returns boolean`;
  - `booking_refund_to_send(p_booking) returns table(payment_id, payment_intent_id, amount, currency, idempotency_key)`;
  - `booking_record_refund_failed(p_payment, p_reason)`;
  - the internal delegates `booking_payment_succeeded`, `booking_payment_failed` and `booking_refund_succeeded`.
- `record_payment_succeeded`, `record_payment_failed` and `record_refund_succeeded` are recreated. They delegate first, then run their previous bodies verbatim.
- Every money change is audited: `booking.pay`, `booking.paid`, `booking.refund_queued`, `booking.refunded` and `booking.released`.

## Server and UI (apps/web)
- **`lib/bookings/payments.ts`:** `createBookingPayments(deps)`.
  - `pay(orgId, bookingId)`: the `approveAndPay` sequence. `booking_pay`, then expire the previous session (a "complete" answer means duplicate), then destination, `createCheckout` (success and cancel URLs `/bookings?org=…&paid=1`), and the attach compare-and-set (losing means expire and duplicate). Returns the URL.
  - `sendRefund(bookingId)`: reads `booking_refund_to_send` and calls `provider.refundPayment` with its idempotency key. A failure is recorded (`booking_record_refund_failed`) and returns `{ok:false}`.
- **Actions:**
  - `payBookingAction` (rate rule `checkout`, existing);
  - `cancelBookingAction`: after `booking_cancel` returns `refund_pending`, calls `sendRefund`;
  - `retryBookingRefundAction`.
- **UI:**
  - **Settings:** a price field per service next to the slot length, saved with `service_set_booking_price`. Disabled with a "Finish payout setup" link when payouts aren't enabled.
  - **Service-page picker:** shows the price ("$50.00 per session, paid after the professional confirms") and the cancellation rule.
  - **Bookings list:** the payment state as "Payment due by <time>" with a **Pay now** button for the client, "Paid", "Refund pending" with **Retry refund**, "Refunded" and "Payment overdue". A paid-return banner says the payment is being confirmed.
- `booking_offer` stays as it is (minutes only). The price is read through a new `booking_price_offer(p_service)` (also anon, listed services only) that returns `{price, currency}` or null.

## Tests
- **pgTAP (`044_paid_bookings.test.sql`):**
  - The price needs payout setup, and roles are checked.
  - Request snapshots the price and commission.
  - Confirm needs payout setup and sets `pay_by` (window and start cap), and refuses when it's too close to the start.
  - Pay: roles, state, window, fee math (rounding, minimum fee), the upsert returns the previous session.
  - Webhook delegate: a match records it, a mismatch, a duplicate, `duplicate_charge`, and paid after release → refund queued.
  - `payment_failed` affects only the current session; `refund_succeeded` matches and finalizes.
  - Cancel refund matrix: provider any time → refund; client ≥ cut-off → refund; client < cut-off → none; unpaid → none.
  - A lapsed unpaid slot is free for slots and released on the next request.
  - Contract payments still route as before (an existing contract payment id → milestone path).
  - Column privacy and no direct writes.
- **Race:** parallel `booking_pay` calls for one booking leave one `booking_payments` row.
- **vitest:** the `pay` sequence with a fake provider (stale session complete → duplicate; attach lost → expire and duplicate; success URL), `sendRefund` success and failure, action error mapping, presenter payment labels, and the price input parsing (no silent rounding).
- **e2e:** existing anonymous gates (no new routes).

## Review focus
- Any path that marks a booking paid without a matching verified webhook.
- Two live checkouts for one booking.
- A refund sent twice, or for the wrong amount.
- The refund rule's boundary at exactly the cut-off.
- Paying after release or cancellation.
- Contract payments broken by the delegation.
- The provider reading payment ids, or a third org reading anything.
- Fee rounding drift from `lib/money.ts`.

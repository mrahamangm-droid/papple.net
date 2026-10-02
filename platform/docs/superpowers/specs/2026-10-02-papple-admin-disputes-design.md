# PAPple Sub-project 4: Admin dispute queue, rulings and refunds

Status: draft for review. Builds on sub-project 3 (contracts and payments, PR #22).

## Goal

A platform Admin can work a queue of open disputes, read the evidence, and rule. A ruling settles the contract and, when the ruling says so, returns the client's money through Stripe. Today a dispute freezes a contract and `resolve_dispute` exists in SQL, but nothing can reach it and no money can move back.

## Decisions carried in

- Papple holds no funds; refunds go through Stripe (Connect destination charges).
- On a refund the client gets back everything they paid (milestone plus client fee). Papple's commission is returned and the professional's transfer is reversed. Stripe's processing fee is not recoverable and is Papple's cost.
- Admin actions use the audited admin wrapper and require aal2.
- Out of scope: the wider Admin console (users, organizations, taxonomy, settings, audit viewer), partial or split refunds, chargebacks, tax documents.

## Outcomes

`resolve_dispute(p_dispute, p_outcome, p_note)` keeps `resume`, `complete`, `cancel` and gains `refund_cancel`.

| Outcome | Contract ends as | Money |
|---|---|---|
| `resume` | `active` (or `completed` if every milestone is paid) | none |
| `complete` | `completed` | none |
| `cancel` | `cancelled` | none |
| `refund_cancel` | `cancelled` | every `succeeded` payment on the contract is queued for a full refund |

A note of 10 to 1,000 characters is required for every outcome.

## Data

- `payments.status` gains `refund_pending` and `refunded` (check constraint extended).
- New table `refunds`: `id`, `payment_id` unique, `dispute_id`, `amount`, `currency`, `status` (`pending`, `succeeded`, `failed`), `provider_refund_id`, `idempotency_key` unique, `failure_reason`, `created_at`, `updated_at`. Service role writes; platform staff and contract parties read through RLS.
- `disputes.resolution` accepts `refund_cancel`.

## Flow

1. Admin opens `/admin/disputes`, a queue of open disputes oldest first, then a detail page with the contract, milestones, payments, reason, and message thread.
2. Admin submits the ruling form. The server action calls `resolve_dispute` as the signed-in Admin.
3. For `refund_cancel` the database function, in the same transaction, locks milestone then contract then payment (the existing order), sets each `succeeded` payment to `refund_pending`, inserts one `refunds` row per payment with a deterministic idempotency key, audits, and notifies both organizations.
4. After the transaction the server calls `PaymentProvider.refundPayment` for each pending refund. The Stripe call reverses the transfer and refunds the full charge including the application fee, using the idempotency key.
5. The verified `charge.refunded` webhook calls a service-only RPC that marks the refund `succeeded` and the payment `refunded`. A Stripe error leaves the row `pending` with `failure_reason`; the dispute page shows a Retry button that repeats the call safely.

## Safety rules

- Only `succeeded` payments are refundable; one refund per payment (unique index).
- The refund amount equals the amount charged, read from the payment row, never from the client.
- Webhook handling is idempotent through `webhook_events`; a refund event for an unknown payment is ignored and logged.
- A `resume`, `complete` or `cancel` ruling never touches payments.
- Non-admins, admins without aal2, and resolved disputes are rejected with the existing error codes (42501, 22023).

## Interfaces

- `PaymentProvider.refundPayment({ paymentId, paymentIntentId, amountMinor, currency, idempotencyKey }): Promise<{ refundId: string }>`; new `ProviderEvent` kind `refund_succeeded`.
- Service-only RPCs: `list_pending_refunds(p_dispute)`, `record_refund_succeeded(p_payment, p_refund)`, `record_refund_failed(p_payment, p_reason)`.

## Testing

- pgTAP: ruling matrix for all four outcomes, role and aal2 checks, refund row creation, one-refund-per-payment, no refund for non-succeeded payments, RLS visibility, service-only grants.
- Unit: refund service with a fake provider (success, Stripe failure, retry, idempotency), webhook mapping and idempotency, queue and detail presenters.
- NOT VERIFIED until Stripe Connect is enabled: live refund and transfer reversal.

## Review focus

- Retry after a partial failure (two payments, first refund succeeds, second fails).
- Webhook arriving before the server stores the refund id.
- A client paying a milestone while a dispute is being ruled.
- Currency or amount mismatch between the refund event and the payment row.

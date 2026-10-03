# PAPple plans and billing (SaaS tools, slice A) — design

Status: approved by the owner in chat on 2026-10-04 ("Approve, build it"). Slice B (invoicing, CRM, team workspace) follows.

## Goal
Make organizations' plans real: a subscription decides the plan, `org_plan_key()` reads it, so every plan limit (including the AI allowance) follows what the organization pays for.

## Rules
- Only a verified Stripe webhook changes subscription state (service role). Users only start Checkout or open the Stripe portal; both are owner-only.
- Stripe is the source of truth for status; the database mirrors it. Out-of-order events never move state backwards (`event_at`).
- Payments of milestones (Connect, destination charges) and subscriptions (platform account) stay separate flows on the same webhook endpoint.
- No live Stripe call is verified in this slice; it needs Billing enabled, prices created and keys supplied by the owner.

## Data (migration 0031_billing.sql)
- `subscriptions(org_id pk, plan_key → plans, status, stripe_customer_id, stripe_subscription_id unique, current_period_end, cancel_at_period_end, past_due_since, event_at, updated_at)`. RLS: members and admins read the non-Stripe columns; nobody writes directly.
- `org_plan_key(org)`: the subscription's plan while status is `active` or `trialing`, or `past_due` for up to `billing.grace_days` (setting, default 7) since `past_due_since`; otherwise `free`. A plan that is inactive or missing also yields `free`.
- Service-role RPCs: `apply_subscription_event(org, customer, subscription, price, status, period_end, cancel_at_period_end, event_at) → 'applied'|'stale'|'unknown_org'|'unknown_plan'` (price resolved to a plan via `plans.stripe_price_id`; stale = `event_at` not newer than stored); `org_billing_customer(org)`; `plan_for_price(price)`.
- User RPC `can_manage_billing(org)`: owner of an active organization.
- `plan_feature(org, key) → boolean`: `plans.features ->> key = 'true'` for the organization's current plan (members only; non-members get false).
- Setting `billing.grace_days` (seeded by the migration, registry range 0..30).

## Server
- `ProviderEvent` gains `subscription_changed` from `customer.subscription.created|updated|deleted` (org id from `metadata.org_id`; `deleted` is status `canceled`; period end read from the subscription or its first item). Missing org id or price → `ignored`.
- Webhook handler routes it to `db.recordSubscription` once per event id; `unknown_org` and `unknown_plan` raise an alert.
- `BillingProvider`: `createSubscriptionCheckout` (mode subscription, price from `plans.stripe_price_id`, `subscription_data.metadata.org_id`, existing customer reused) and `createPortalSession`.
- `lib/billing/service.ts`: `startCheckout({orgId, planKey})`, `openPortal({orgId})` → `{ok:true,url}` or `{ok:false,code}`; signed-in, owner-only (`can_manage_billing`), rate limited (`billing`, 10/min), plan must be active with a price, an organization that already has a live subscription is sent to the portal (never a second subscription), returned URL must be https on a Stripe host.
- `/settings/billing`: current plan, status, renewal or cancellation date, upgrade buttons (only plans with a Stripe price), Manage billing (only with a customer). Non-owners see read-only text.
- `/admin/organizations` shows the plan and subscription status.

## Out of scope
Tax or VAT on subscriptions, annual discounts, trials, usage-based billing, invoices for subscriptions (Stripe sends receipts), the SaaS tools themselves.

## Review focus
Webhook replay and out-of-order delivery; unknown price or org; subscription for a suspended org; past_due grace edge; a second checkout while subscribed; non-owner starting checkout; open redirect via returned URL; downgrade (cancel) returning to free limits; user reading Stripe ids; two orgs sharing a customer.

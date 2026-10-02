# Papple architecture (Foundation)

Papple — Global Professional Marketplace & AI Business Platform, by Papple World FZE LLC. A technology platform: not an employer or recruitment agency, and it never holds customer funds.

```
Browser ─▶ Cloudflare (DNS, TLS, WAF) ─▶ Vercel: Next.js 16 (App Router)
                                           ├─ src/proxy.ts      session refresh, CSP nonce, security headers, optimistic route gate
                                           ├─ server actions    auth, onboarding (rate-limited, Zod-validated)
                                           ├─ route handlers    /api/uploads/*, /api/files/sign, /auth/callback
                                           └─ lib/              rbac, audit, settings, ratelimit, storage, webhooks
                                         ├─▶ Supabase: Postgres + RLS (tenancy), Auth (+TOTP MFA)
                                         └─▶ Cloudflare R2 (private; 5-minute signed URLs)
Stripe Connect · Resend · Sentry · PostHog arrive in later sub-projects / opt-in per environment.
```

**Tenancy.** Shared schema; every business table carries `org_id`; Postgres RLS enforces isolation via `SECURITY DEFINER` helpers (`is_member`, `has_org_role`, `is_platform_admin`, `shares_org`) that read `memberships` live, so removing a member takes effect immediately even with a valid JWT. See ADR 0001.

**Authorization.** Only `memberships` (org roles) and `platform_roles` grant access; the signup "persona" only shapes onboarding and navigation. `decideAccess()` is a pure function used by `requireCapability()` (pages) and `authorizeApi()` (route handlers). The proxy is an optimistic gate only; every protected page/route re-checks.

**Configuration is data.** `plans`, `platform_settings` (+ `settings_history`), `feature_flags` (+ per-org overrides). Launch seed: Professional commission 500 bps, Client fee 200 bps, Plus 999¢, Business 1999¢, Enterprise custom, Free. Money = integer minor units; rates = basis points (`lib/money.ts`).

**Dependency injection.** Services (`createSettings`, `createAuditWriter`, `createAdminAction`, `createOnboarding`, `createStorage`, `createRateLimiter`, webhook store) take their I/O as arguments so they are unit-testable; `lib/server.ts` and `lib/r2.ts` hold the production wiring and are lazy so `next build` needs no secrets.

**Rendering and CSP.** A strict nonce-based CSP forces per-request (dynamic) rendering of all routes (`await connection()` in the root layout). Trade-off: no full-page HTML caching. Public SEO pages (sub-project 8) must revisit this (SRI or a separate policy for marketing routes).

**Audit.** `audit_log` is append-only (trigger blocks UPDATE/DELETE/TRUNCATE even for the service role); payloads are redacted; IPs are salted-hashed. Privileged server actions go through `adminAction()`.

**Known limits.** In-memory rate-limit fallback is per instance; Upstash makes it global. Real Supabase/R2/Stripe behaviour is verified only on staging (see `docs/acceptance-subproject-1.md`).

## Marketplace core
- Public surface is whitelisted views only (`public_provider_cards`, `public_service_cards`, `public_open_projects`); base tables stay default-deny for `anon`.
- All writes go through `SECURITY DEFINER` RPCs that take an explicit `p_org` and re-check the caller's role. Error codes: 42501 not allowed, 22023 invalid, 54000 limit, 23505 duplicate.
- Search: Postgres full-text (`websearch_to_tsquery`) plus `pg_trgm`, keyset-paginated. Matching is rule-based and returns reasons, never a numeric score; weights live in `platform_settings`.
- Web layer: dependency-injected factories (`createSearchHandler`, `createActions`, `createCronHandler`, `createEmailNotifier`) wrapped by thin route/server-action files, so logic is unit-testable without a database.

## Contracts and payments
- Papple never holds customer funds: a client pays per milestone through Stripe Checkout as a destination charge (`transfer_data.destination` + `application_fee_amount`); the professional's Stripe Express account receives the rest. Commission (5% professional + 2% client at launch) is data in `platform_settings`, snapshotted on each contract at hire.
- Only the verified Stripe webhook marks a payment `succeeded` (service-role-only RPC `record_payment_succeeded`, keyed by payment id, amount and currency checked). Clients can only ask for approval; they cannot read or write payment state, the Checkout session id or the Stripe account id (column grants).
- Lock order everywhere: milestone, then contract, then payment. One payment per milestone (unique), one live contract per project (partial unique index).
- Retry safety: `approve_milestone` reports the previous Checkout session; the server expires it, and refuses to open another if it was already paid (`expireCheckout` returns `complete`). `attach_checkout_session` is a compare-and-set against that session, so only one live session exists. A failure event only affects the payment's current session.
- Provider boundary: `PaymentProvider` (Stripe adapter plus a fake in tests). Platform and Connect events use separate Stripe signing secrets (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`).
- Disputes freeze a contract; resolution needs platform staff plus aal2 and is audited. Reviews are blind and close once the other side's review is visible; the public aggregate is `public_provider_ratings`.
- Dispute rulings (SP4): `resolve_dispute(p_dispute, p_outcome, p_note)` takes `resume`, `complete`, `cancel` or `refund_cancel` and a 10-1,000 character note, from platform staff with aal2 only. `refund_cancel` cancels the contract and, in the same transaction, moves every `succeeded` payment to `refund_pending` and inserts one `refunds` row each (unique per payment, idempotency key `refund:<payment id>`, amount = the full `client_total`). Locks: dispute, the contract's milestones, contract, payments.
- Refund flow: the database commits the ruling first; the server then calls `PaymentProvider.refundPayment` (full refund, `refund_application_fee`, `reverse_transfer`, Stripe idempotency key). A Stripe failure leaves the refund `pending` with a reason and the admin sees Retry. The verified `refund.created`/`refund.updated` event (status `succeeded`, `metadata.payment_id`) calls `record_refund_succeeded`, which checks amount and currency, marks the refund `succeeded` and the payment `refunded`. The Stripe endpoint must subscribe to those two events. Migration 0021 treats `refund_pending` and `refunded` as final for `record_payment_succeeded` (a second charge is flagged, the refund target is never overwritten) and reports money arriving on a cancelled contract as `paid_on_cancelled`.
- Fee math lives in SQL (`approve_milestone`, the authority) and TypeScript (`computeMilestoneCharge`), both half-up integer arithmetic on minor units.

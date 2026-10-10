# Papple — Global Professional Marketplace & AI Business Platform

Papple World FZE LLC. A technology marketplace and SaaS platform; not an employer, recruitment agency or payment institution.

- `apps/web` Next.js app · `supabase/` schema, RLS, tests · `docs/` specs, plans, runbooks
- Start: `pnpm -C apps/web install && pnpm -C apps/web dev` · Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Marketplace core (Sub-project 2)
Profiles, services, search, projects, proposals, messaging, notifications, reports and moderation. Spec: `docs/superpowers/specs/2026-10-02-papple-marketplace-core-design.md`. What is and is not verified: `docs/acceptance-subproject-2.md`.

## Contracts, payments, reviews and disputes (Sub-project 3)
Hire from a shortlisted proposal, agree milestones, pay per milestone through Stripe Connect (Papple holds no funds), blind two-way reviews and a dispute freeze. Spec: `docs/superpowers/specs/2026-10-02-papple-contracts-payments-design.md`. What is and is not verified: `docs/acceptance-subproject-3.md`. Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`; without them checkout is unavailable and the webhook answers 503.

## Admin console (Sub-project 4b)
Settings, feature flags and plans, an audit-log viewer, organization suspension, staff roles and provider verification. Spec: `docs/superpowers/specs/2026-10-02-papple-admin-console-design.md`. What is and is not verified: `docs/acceptance-subproject-4b.md`.

## Admin console, slice 2 (Sub-project 4c)
Moderation queue, hidden-items list, taxonomy editor and an overview page. Spec: `docs/superpowers/specs/2026-10-02-papple-admin-moderation-design.md`. What is and is not verified: `docs/acceptance-subproject-4c.md`.

## Spend approvals (procurement slice 1)
A client organization's owners can require their approval before an admin accepts a contract at or above an amount they set (`/settings/approvals`). The admin's acceptance becomes a request in `/approvals`; an owner approves (which accepts the contract) or rejects with a reason. An approval covers the exact price and milestone schedule; any change lapses it. Spec: `docs/superpowers/specs/2026-10-13-papple-spend-approvals-design.md`. What is and is not verified: `docs/acceptance-spend-approvals.md`.

## Bookings (bookings slice 1)
Clients book open times on a professional's service page (`Book a time`), shown in their own time zone. The professional sets weekly hours, a gap between calls, minimum notice and how far ahead people can book in `/settings/bookings`, picks a slot length per service, and confirms or declines requests in `/bookings`. Either side cancels with a reason; confirmed bookings download as a calendar file. The database rules out double bookings. Spec: `docs/superpowers/specs/2026-10-14-papple-bookings-design.md`. What is and is not verified: `docs/acceptance-bookings.md`.

## Paid bookings (bookings slice 2)
A professional with finished payout setup can set a price per bookable service. After they confirm a request, the client pays through Stripe Checkout within a window (24 hours by default, never later than 1 hour before the start); an unpaid booking's time is released. Papple keeps the usual contract commission. If the professional cancels, the client gets a full refund; if the client cancels at least 24 hours before (an admin setting), they get a full refund; later, none. Only the verified Stripe webhook marks a booking paid or refunded. Spec: `docs/superpowers/specs/2026-10-15-papple-paid-bookings-design.md`. What is and is not verified: `docs/acceptance-paid-bookings.md`.

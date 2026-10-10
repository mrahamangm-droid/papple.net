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

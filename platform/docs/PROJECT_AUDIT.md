# PAPple project audit

Audit date: 2026-10-09. Method: read the repository, re-ran the test suites on the audited commit, and checked the live GitHub, Supabase and Vercel state through the owner's signed-in browser. Anything not verified is marked as such.

Audited commit: `908abf0` (branch `feat/analytics`, local). On GitHub, `main` contains the same platform files (PR #36 and #37 merged); the local branch is ahead only by documentation.

## Stack (found, preserved)

Next.js 16 App Router, TypeScript, Supabase (Postgres, Auth, RLS), Cloudflare R2, Stripe Connect (destination charges), Resend, Sentry, Upstash rate limiting (optional), Vercel. Monorepo layout: `platform/apps/web` (the app), `platform/supabase` (40 migrations, tests, seed), `platform/docs`. The GitHub repository root also contains a separate Next app; Vercel must use root directory `platform/apps/web`.

## Status by area

Legend: EXISTS (built and tested locally), PARTIAL, MISSING, BLOCKED.

| Area | Status | Evidence |
|---|---|---|
| Identity, organizations, roles, invitations, tenant isolation | EXISTS | migrations 0001-0005, 0023, 0035; pgTAP |
| Marketplace: profiles, services, search, projects, proposals, messaging, reports | EXISTS | migrations 0006-0014 |
| Contracts, milestones, payments, refunds, late payments | EXISTS | migrations 0015-0021 |
| Disputes and reviews, admin ruling | EXISTS | 0018, 0020, admin disputes |
| Admin console (users, orgs, plans, settings, audit, taxonomy, moderation, verification) | EXISTS | 0022-0028 |
| AI copilot, quotas, usage | PARTIAL | 0029-0030: drafting and assistance; no document intelligence |
| Subscriptions and plan entitlements | EXISTS (test mode only) | 0031 |
| Invoicing | EXISTS | 0032; not accountant-reviewed |
| CRM and CRM email | EXISTS (email off by flag) | 0033-0034 |
| Team workspace | EXISTS | 0035 |
| PGAN credentials and checks | PARTIAL | 0036: link evidence only, no file upload, no registry checks, no expiry emails |
| Enterprise talent pools and invitations | EXISTS | 0037 |
| Analytics | EXISTS | 0038 |
| Read-only API (keys, 4 endpoints) | EXISTS | 0039 |
| Legal pages, SEO, security headers | EXISTS (draft text) | owner legal review pending |
| Project and task management, time records | MISSING | next slice |
| Document store, OCR, extraction | MISSING | |
| Client portal | MISSING | |
| Workflow automation engine | MISSING | |
| Bookings, calendar, recurring services | PARTIAL | Bookings slice 1 (migration 0043): weekly hours, slot picker, confirm/decline/cancel, calendar file. No payment, calendar sync or recurring bookings. |
| Procurement and approval chains | PARTIAL | Spend approvals (owner approval above a threshold, migration 0041), budgets per month or quarter (0045) and approval tiers needing up to three different owners (0047). No named sequential chains, delegation or purchase orders. |
| Webhook management for customers | MISSING | |
| Production deployment | BLOCKED | see below |

## The blocker

The application and database are built and tested, but nothing is deployed anywhere. Staging state, verified on 2026-10-09:

- GitHub `main`: complete (platform files merged).
- Staging Supabase project `papple-staging`: migrations 0001-0039 and the seed applied; 57 public tables, all with RLS enabled; the four staging limit settings applied.
- Vercel project `papple-staging` created and linked to `main` with root `platform/apps/web`, but no deployment exists. The Vercel team it belongs to shows a failed-payment notice ("pay any open invoices"). That is the most likely cause; it was not confirmed. Paying is an owner action.

## Findings from this audit

1. The GitHub copy had been incomplete: 124 platform files existed only locally (migrations 0006-0021 and their tests, the marketplace, contracts, payments and disputes code, three acceptance notes, plans and specs). Fixed by PR #37; every file was verified by git blob hash against the local copy.
2. A multi-file web upload of 26 files failed silently once and had to be repeated in smaller commits. Verification by hash is what caught it; do not trust an upload without a tree comparison.
3. Real Stripe, Resend and R2 behaviour has never been exercised against real accounts. Test mode on staging is the next verification step.

## Not verified

Production data, production deployment, real payment flows, email delivery, Upstash global rate limiting, backup restoration on the hosted Supabase project.

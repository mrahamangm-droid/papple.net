# PAPple Platform — Program Roadmap & Sub-project 1 (Foundation) Design

Brand: **Papple — Global Professional Marketplace & AI Business Platform**
Company: **Papple World FZE LLC**
Date: 2026-10-02 · Status: DRAFT for owner review

---

## 1. Purpose and success criteria

PAPple is a technology marketplace and SaaS platform connecting Clients, Professionals, Agencies, Consultants, Experts and Enterprises, with business tools and AI. It launches as an MVP and must have a clean architecture for scale.

Papple is a **technology platform**. It is not an employer, not a recruitment agency, and **not a payment institution; it never holds customer funds**.

Program-level success = the core journey works end to end in production:
Signup → Profile → Search/Post Project → Match → Proposal → Messaging → Contract → Milestone → Payment → Delivery → Approval → Review → Subscription.

This document contains (a) the program roadmap and (b) the full design for **Sub-project 1: Foundation**. Sub-projects 2–8 each get their own spec → plan → build → verify cycle.

## 2. Audit of existing assets (read-only, 2026-10-02)

| Asset | Status | Decision |
|---|---|---|
| `papple.net` repo (Next 14, NextAuth, Prisma, Stripe, Claude streaming assistant, admin queue, org invites, JSON-LD/sitemap) | PARTIAL: advisory/PGAN site, not a marketplace | Remains untouched as the advisory site. Patterns are ported, code is not copied wholesale. |
| `saas-platform-kit` (reusable CI, security, Supabase migrations, Cloudflare deploy, R2 backup workflows; bootstrap + branch-protection scripts) | EXISTS | Consumed as `@v1` reusable workflows. Gaps found during adoption are fixed there via PR. |
| Marketplace, contracts, milestones, Connect payments, messaging, reviews, disputes, CRM, invoicing, pricing admin | MISSING | Built in sub-projects 2–7. |
| Supabase DB, RLS, R2 storage, Sentry | MISSING | Built in sub-project 1. |
| `finloraq`, `softqora`, `businesspilotos` | Separate products | Not touched. |

No dedicated `papple` marketplace repo exists. **Decision (owner):** create new repo `papple`.

## 3. Program decomposition (build order)

1. **Foundation** — repo, Supabase schema + RLS, auth/RBAC/tenancy, config/settings layer, CI/CD, security baseline. *(this spec)*
2. **Marketplace core** — profiles, services, categories, search/filters, project posting, proposals, matching (rule-based first), messaging, notifications.
3. **Contracts & money** — contracts, milestones, Stripe Connect Express onboarding, destination charges, application fees (commission), refunds, payouts status, invoices, webhooks, reviews, disputes.
4. **Admin console** — users, roles, verification, PGAN, projects/proposals/contracts, payments/commissions/payouts, subscriptions, disputes, reviews, content, categories, AI usage, legal pages, platform settings, pricing, feature flags, audit logs, system health.
5. **SaaS tools** — CRM, contacts, leads, tasks, teams, documents, invoices, expenses, calendar, dashboards/analytics.
6. **AI layer** — matching assist, proposal assistant, profile optimisation, project assistant, document analysis, CRM assistant, workflow automation, BI. Human confirmation for consequential actions; usage limits and tracking.
7. **PGAN & Enterprise** — verified expert profiles/credentials/ratings; private talent pools, teams, advanced permissions, analytics, API access.
8. **Legal, SEO, hardening, final validation** — configurable legal pages, sitemap/robots/OG/schema, performance, full security and journey validation, production verification.

Each sub-project is independently shippable and gated by its own acceptance tests.

## 4. Decisions locked

- **Stack:** GitHub → Cloudflare (DNS/CDN/WAF/R2) → Vercel (or Cloudflare Workers) → Next.js (App Router, TypeScript strict) → Supabase (Postgres, Auth, RLS) → Cloudflare R2 → Stripe → Resend → Sentry + PostHog.
- **Payments (owner-approved):** Stripe Connect **Express** accounts for Professionals, **destination charges**, Papple commission collected as an **application fee**. Stripe holds funds and performs KYC, payouts and refunds. Papple stores only Stripe IDs and status, never card or bank data.
- **Pricing/commissions/limits are data, not code:** read from admin-editable tables (section 6.3). Launch values are seed data only: Professional commission 5%, Client fee 2%, Professional Plus $9.99/mo, Business $19.99/mo, Enterprise custom, Free Client plan.
- **Auth:** Supabase Auth (email+password, magic link, Google OAuth optional), TOTP MFA enabled and enforceable per role.
- **Tenancy:** shared database, shared schema, `org_id` on every business row, isolation enforced by Postgres RLS (not application code alone).

### Pre-build verification items (must be confirmed before sub-project 3, not assumed)
1. Stripe Connect availability and supported account types for Papple World FZE LLC's jurisdiction and for Professionals' countries; fall back to a different marketplace provider if Express is unavailable.
2. Whether the 2% Client fee is charged as a separate line item and how it appears on invoices and in tax treatment (needs accountant/legal review).
3. Counsel review of all legal pages before launch (sub-project 8).

## 5. Sub-project 1 scope

In: repository, environments, schema + RLS for identity/tenancy/config/audit, auth and onboarding (pick role), RBAC, role-gated shell dashboards, settings and feature-flag service, rate limiting, audit logging, storage client scaffold (R2 signed URLs), CI/CD, security scanning, migrations workflow, backups, rollback runbook, documentation, test harness.

Out (later sub-projects): marketplace entities, payments, AI, CRM, full admin console, legal content, SEO pages.

## 6. Design

### 6.1 Repository layout
```
papple/
  apps/web/                  Next.js app (App Router)
    src/app/(public)/ (auth)/ (app)/ api/
    src/lib/ (supabase, auth, rbac, settings, audit, ratelimit, storage, validation)
  supabase/
    migrations/              timestamped SQL, forward-only
    seed.sql                 launch plans/commission/flag defaults (non-secret)
    tests/                   pgTAP RLS tests
  docs/                      architecture, runbooks, ADRs, specs, plans
  .github/                   workflows calling saas-platform-kit@v1, CODEOWNERS, templates
  .env.example               names only, never values
```

### 6.2 Identity, tenancy, RBAC
- `profiles` (1:1 with `auth.users`): display name, locale, status.
- `organizations`: `id`, `type` (`individual|agency|client_company|enterprise`), `name`, `status`, `created_by`.
- `memberships`: `user_id`, `org_id`, `role`. Org roles: `owner|admin|member|viewer`.
- Platform roles in `platform_roles` (`user_id`, `role` ∈ `admin|support`), writable only by service role. Account personas (`client`, `professional`, `agency`, `enterprise`, `pgan_expert`) are stored on `profiles`/org capability flags and drive onboarding and navigation; **authorization decisions use memberships and platform_roles, not personas**.
- Helper SQL functions `is_member(org_id)`, `has_org_role(org_id, roles[])`, `is_platform_admin()` are `SECURITY DEFINER`, `STABLE`, with fixed `search_path`.
- Default-deny: RLS enabled on every table in `public`; a CI check fails the build if any table lacks RLS or has no policy.
- Admin operations use a server-only service-role client behind an `adminAction()` wrapper that checks `is_platform_admin()`, validates input, and writes an audit row.

### 6.3 Configuration layer (admin-editable)
- `plans` (`key`, `name`, `audience`, `price_cents`, `currency`, `interval`, `limits jsonb`, `features jsonb`, `active`, `stripe_price_id`).
- `platform_settings` (`key`, `value jsonb`, `description`, `updated_by`, `updated_at`), including `commission.professional_bps`, `commission.client_bps`, `ai.monthly_limits`, `payments.enabled`.
- `feature_flags` (`key`, `enabled`, `rollout jsonb`, optional per-org overrides).
- All numeric money logic uses integer minor units and basis points. Reads go through a typed `settings` service with short-TTL cache; every write is audited and versioned (`settings_history`).

### 6.4 Audit and privacy
- `audit_log` (append-only; no UPDATE/DELETE policy): actor, org, action, entity, before/after (redacted), IP hash, request id.
- Privacy: data-export and account-deletion request tables (processed in sub-project 8); PII columns documented; no secrets or payment instrument data stored.

### 6.5 Security baseline (OWASP-aligned)
- Zod validation at every server boundary; parameterised queries only.
- Rate limiting on auth, invites and expensive endpoints (Upstash Redis free tier or Postgres-backed fallback behind one interface).
- Security headers and strict CSP; CSRF-safe patterns (same-site cookies, server actions); open-redirect-safe `next` params.
- Secrets only in GitHub/Vercel/Supabase environment stores; gitleaks in CI; `.env*` ignored.
- R2: private buckets, per-object keys scoped by `org_id`, short-lived signed URLs, server-side MIME and size validation (magic-byte check), virus-scan hook point reserved.
- Webhook endpoints (introduced in sub-project 3) must verify signatures and be idempotent; the verification helper and idempotency table are scaffolded here.
- Sentry with PII scrubbing; PostHog opt-in, cookie banner wired to consent.

### 6.6 Environments and delivery
- Three environments: **dev** (local Supabase via CLI), **staging** (separate Supabase project + Vercel preview/staging), **production**.
- `main` protected: PR required, status checks (lint, typecheck, unit, RLS tests, build, gitleaks, dependency review, CodeQL where available), linear history. Configured with the kit's `apply-repo-settings.sh`.
- Migrations: PR runs dry-run against a shadow DB; staging applies on merge; production applies via manual-approval GitHub Environment; destructive SQL blocked by the kit's guard unless explicitly allowed.
- Deploy: Vercel from GitHub with preview per PR; Cloudflare in front for DNS, TLS (Full strict), WAF and caching.
- Backups: Supabase automated backups (verify plan retention) plus the kit's nightly encrypted `pg_dump` to R2; restore drill documented and run once before launch.
- Rollback: app = Vercel instant rollback to previous deployment; DB = forward-only migrations with a paired "undo" note per migration and point-in-time-recovery as last resort.

### 6.7 Cost posture
Free/low tiers at launch (GitHub, Cloudflare free, Vercel Hobby→Pro when commercial use requires it, Supabase free→Pro before real customer data, R2 free allowance, Resend/Sentry/PostHog free tiers). Note: Vercel Hobby prohibits commercial use and Supabase free projects pause when idle — both must be upgraded before production launch with paying users.

### 6.8 UX baseline
Mobile-first, accessible (WCAG 2.2 AA targets), design tokens in one theme file, shared components (Button, Input, Card, Table, Dialog, Toast), role-aware navigation shell, original brand design (no competitor assets).

## 7. Testing and acceptance (Sub-project 1 "done")

1. **Tenant isolation:** pgTAP + integration tests prove user in org A cannot select/insert/update/delete org B rows on every tenant table; run in CI.
2. **RBAC:** each role can/cannot reach each protected route and API (matrix test).
3. **Auth:** sign-up, email verification, sign-in, password reset, TOTP enrol/challenge work on staging.
4. **Config:** admin changes a commission/plan value and the change is read by the app and audited; non-admin cannot.
5. **Security:** CI green for lint, types, tests, gitleaks, dependency review; headers verified; rate limit triggers on auth abuse test.
6. **Delivery:** PR → preview → staging → production-with-approval pipeline executes; rollback rehearsed; backup restore rehearsed.
7. **Docs:** architecture, env/secrets reference, runbooks (deploy, rollback, restore, incident) exist.

## 8. Owner-supplied prerequisites (entered by the owner into secret stores; Claude never handles raw credentials)
- Permission to create the `papple` repository and push (GitHub).
- Supabase projects (staging, production); Cloudflare account/zone and R2 bucket; Vercel project; later Stripe (test, then live), Resend, Sentry, PostHog.
- Domain decision for the marketplace (e.g. `papple.com` vs a subdomain), and which legal entity details appear on public pages.

## 9. Risks
- Payments jurisdiction/provider availability (section 4 items) could change sub-project 3.
- Free-tier limits and commercial-use terms (section 6.7).
- Scope size: mitigated by strict sub-project gating; no sub-project starts until the previous one's acceptance tests pass.
- Legal pages are templates until counsel reviews them.

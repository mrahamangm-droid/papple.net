# Papple.net — Build 1 + Build 2 + Build 3 + Build 4 (+ 4.1 gap-closing pass)

**Build 1** — Premium Corporate Website + Lead Generation: advisory
positioning, six core capabilities, five advisory service pages, a Research
& Knowledge Center, and four lead-generation workflows (Request Advisory,
Request an Expert, Contact, Newsletter).

**Build 2** — Construction Intelligence Tools: six free, genuinely
functional diagnostic tools (no registration wall, no fabricated benchmark
data) that connect back into Advisory, Research and PGAN — plus the
database architecture, analytics events and lead capture that support them.

**Build 3** — PGAN (Papple Global Advisory Network) Expert Workflow: a
curated, reviewed expert network — not a freelancer marketplace. A real,
validated, rate-limited application flow for specialists (`/pgan/join`),
five public PGAN pages explaining how the network actually works, the
Expert/ClientRequest/match data model, and an internal (never
client-facing) matching-score architecture.

**Build 4** — AI + Subscriptions + Enterprise Platform: real user accounts
(NextAuth.js, credentials + hashed passwords), Free/Professional/Enterprise
subscription tiers with no hardcoded pricing, a Stripe billing integration
that runs demo-safe until real keys are added, the Papple AI Advisory
Assistant (Anthropic Claude, streamed token-by-token, grounded in Papple's
actual services — never fabricated), a project workspace that saves
Construction Intelligence results, and role-gated Admin / Enterprise
dashboards that finally put the Build 3 data model and matching engine to
work. See "What's real vs. architecture-only in Build 4" below.

**Build 4.1 (gap-closing pass)** — closed the three items Build 4 shipped
disclosed and deliberately without: self-service Organization invites (an
OWNER/MANAGER can now invite, revoke and remove members from `/enterprise`
directly, by email token, with server-enforced seat limits), streaming AI
Advisory Assistant responses (token-by-token via the Anthropic Messages
API's SSE stream, not a single request/reply round trip), and Google OAuth
sign-in (additive to the existing Credentials provider, active only when
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set). See "What's real vs.
architecture-only in Build 4" below — updated for this pass.

Built with Next.js 14 (App Router), TypeScript, and Tailwind CSS. Deploy-ready
for Vercel; no database is required to run the public site — every write goes
through a graceful, logging-only fallback until `DATABASE_URL` is configured.
Real sign-in, billing and the AI assistant each activate the moment their own
environment variable is set — no code changes required for any of them.

## Stack

- **Framework:** Next.js 14 (App Router, Server Components)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS with the Papple brand system (`tailwind.config.ts`)
- **Validation:** Zod (shared client + server schemas, `src/lib/validations.ts`)
- **Auth:** NextAuth.js (Credentials provider + optional Google OAuth, JWT sessions, `src/lib/auth.ts`) + bcryptjs password hashing
- **Billing:** Stripe (Checkout, Billing Portal, webhooks — `src/lib/billing.ts`), demo-safe without keys
- **AI:** Anthropic Claude Messages API via raw `fetch` (`src/lib/ai.ts`), demo-safe without a key
- **Email:** Provider-agnostic adapter (`src/lib/email.ts`), wired for [Resend](https://resend.com)
- **Database (optional for the public site; required for accounts):** Prisma + Postgres — schema in `prisma/schema.prisma`, adapter in `src/lib/db.ts`
- **Analytics:** GA4 via `src/components/Analytics.tsx` (loads only if `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set) + a same-origin `/api/tool-usage` event log
- **SEO:** Per-page metadata, `sitemap.ts`, `robots.ts`, JSON-LD (Organization, Person, Service, Article, BreadcrumbList), dynamic OG images via `next/og`

## Getting started locally

```bash
npm install
cp .env.example .env.local   # fill in values as needed (everything is optional for local dev)
npm run dev
```

Visit `http://localhost:3000`. Forms, tools, and lead workflows work out of
the box with zero configuration. Accounts, billing and the AI assistant need
their own env vars (see `.env.example`) — without them, every related page
says so honestly rather than pretending to work.

## Turning on persistence and accounts (optional)

```bash
# 1. Provision Postgres (Vercel Postgres, Supabase, Neon, etc.) and copy its connection string
# 2. Set DATABASE_URL in .env.local / Vercel env vars
# 3. Set AUTH_SECRET (generate with `openssl rand -base64 32`) — required for real sign-in
npm install
npx prisma generate
npx prisma db push
```

No application code changes are required — `src/lib/db.ts` detects
`DATABASE_URL` and switches from logging to writing automatically, and
`src/lib/auth.ts` requires it to look up accounts.

## What's real vs. architecture-only in Build 4

**Real and functional today (once the relevant env var is set):**
- Sign-up (`/signup` → `POST /api/auth/signup`) and sign-in (`/signin`, NextAuth Credentials provider, bcrypt-hashed passwords, JWT sessions) — requires `DATABASE_URL` + `AUTH_SECRET`.
- Google sign-in on `/signin` and `/signup` — real, via NextAuth's Google provider (`src/lib/auth.ts`). Active only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; with either unset, the "Continue with Google" button simply doesn't render (checked server-side, not hidden client-side) rather than appearing and failing. No `PrismaAdapter` is used (see the doc comment in `src/lib/auth.ts` for why); account linking/creation on first Google sign-in is handled explicitly in the `jwt` callback via `findOrCreateOAuthUser` in `src/lib/db.ts`, and only proceeds when Google reports the email as verified.
- `/account` — real plan info, upgrade button, links into every gated feature.
- The Papple AI Advisory Assistant (`/assistant`) — a real Claude API call, **streamed token-by-token** rather than returned as one block, grounded in a system prompt built from Papple's actual advisory services, capabilities and CI tools (`src/lib/ai.ts`, `streamChatMessage`). Requires `ANTHROPIC_API_KEY`; without it — or if the request fails before the stream starts — the assistant says so plainly, as an ordinary error response, rather than faking a reply. The full reply is persisted server-side once the stream completes. Server-enforced monthly usage caps per tier (`src/data/pricing.ts` `aiMonthlyMessageLimit`).
- Project workspace (`/workspace`) — every Construction Intelligence tool now has a real "Save to project workspace" action (signed-in users only) that persists the calculation.
- Stripe billing (`/pricing`, `/account` upgrade button, `POST /api/billing/checkout`, `POST /api/billing/webhook`) — complete, real integration code; runs in demo-safe/logging mode until `STRIPE_SECRET_KEY` + Price IDs are set. No price is ever hardcoded in this codebase (see `src/data/pricing.ts`).
- Admin (`/admin`, ADMIN role only) — reviews real PGAN `Expert` applications and `ClientRequest` rows from Build 3, with status-change controls that write to the new `AuditLog`. This is the first build where `src/lib/pgan/matching.ts` (written in Build 3, never called until now) is actually invoked — from an admin-only, read-only "rank candidates" action. Its score is still never shown to a client or specialist.
- Enterprise team management (`/enterprise`, Organization members only) — real member list from the database, plus **self-service invites**: an OWNER or MANAGER can invite a new member by email (`POST /api/enterprise/invite`), see and revoke pending invites, and an OWNER can remove members. Invites are single-use, expire after 7 days, are rate-limited, respect the organization's seat limit, and can only be accepted by signing in or signing up with the exact invited email address (`/enterprise/accept-invite`). Every organization is guaranteed exactly one OWNER (`setOrganizationOwnerIfNone`, run on every `/enterprise` page load — a no-op once an owner exists, so it also self-heals an org that was seeded directly in the database without one).
- Route-level auth/role gating via `middleware.ts` (using `next-auth/jwt`'s `getToken`), backed by a second check in every gated page/route itself (`src/lib/session.ts`) — defense in depth, not a single point of failure. The one exempted route is `/enterprise/accept-invite`, which has to be reachable by a signed-out invitee; the sign-in redirect preserves the original destination via `callbackUrl` (validated as an internal path before use, to rule out an open redirect) so accepting an invite while signed out round-trips back to the invite correctly.

**Deliberately not built, and why:**
- Self-service Organization *creation*. Adding members to an existing organization is now self-service (see above); creating the organization itself — the first step, with no existing OWNER to send the invite — is still a Papple-assisted, direct-database step. A public "start an Enterprise org" signup flow is a reasonable follow-up, not a gap in what's already built.
- Any UI that shows a match score, acceptance likelihood, or specialist ranking to a client or specialist. `src/lib/pgan/matching.ts` output is admin-only by design (see Build 3's README section, preserved in spirit above).

## Project structure

```
src/
  app/
    advisory/                Advisory hub + 5 dynamic service pages
    tools/                   Tools hub + 6 Construction Intelligence tool pages
    pgan/                    Hub, expertise, how-it-works, for-organizations, experts, join
    account/ admin/ enterprise/ assistant/ workspace/   Build 4 — auth-gated pages
    signin/ signup/ pricing/                            Build 4 — public account pages
    api/
      auth/                  NextAuth route + sign-up
      billing/               Stripe checkout + webhook
      assistant/             AI chat endpoint
      workspace/             Save-calculation endpoint
      admin/                 Status-change + matching endpoints (ADMIN only)
      request-advisory/ request-expert/ contact/ newsletter/ pgan-apply/  Lead forms
      tool-report/ tool-usage/   Tool analytics + email-report
    construction-intelligence/  research/  case-studies/
    corporate-solutions/  about/  contact/  insights/  legal/
    sitemap.ts  robots.ts  opengraph-image.tsx  icon.svg
  components/
    layout/                  Header (incl. Construction Intelligence mega-menu, account nav), Footer, Logo
    sections/                Homepage + reusable page sections
    forms/                   Lead/application forms + shared field primitives
    tools/                   Shared tool UI + calculators/ (6 tool UIs), SaveToWorkspaceButton
    assistant/                ChatPanel (AI Advisory Assistant UI — streams responses)
    admin/                     StatusControl, RankMatchesButton
    enterprise/                AcceptInviteButton, InviteMemberForm, RevokeInviteButton, RemoveMemberButton
    ui/                      Shared presentational components
    AuthSessionProvider.tsx, AccountNavLink.tsx, SignOutButton.tsx, UpgradeButton.tsx
    SignInForm.tsx, SignUpForm.tsx, GoogleSignInButton.tsx    Auth forms (server pages pass googleAuthEnabled in)
    Analytics.tsx            GA4 loader (no-op without NEXT_PUBLIC_GA_MEASUREMENT_ID)
  data/                      Advisory services, capabilities, research, tools, PGAN content, pricing
  lib/
    calculators/              Pure calculation engines for all 6 tools
    pgan/matching.ts           Internal PGAN match-scoring — now called from /admin only
    auth.ts, session.ts, password.ts    NextAuth config (Credentials + optional Google), server-side RBAC helpers, bcrypt
    billing.ts                 Stripe adapter (demo-safe)
    ai.ts                      Anthropic Claude adapter (demo-safe, streaming)
    site-config, validations, email, rate-limit, schema (JSON-LD), db, analytics
  types/next-auth.d.ts        Session/User type augmentation
middleware.ts                Request-size guard + auth/role gating for account/admin/etc.
prisma/schema.prisma          Full database architecture — see "What's real" above
```

## The 6 Construction Intelligence tools

| Tool | Route | What it computes |
|---|---|---|
| Construction Cost Calculator | `/tools/construction-cost-calculator` | Adjusted total cost from your own base rate, contingency, soft costs, sensitivity range |
| Project Profitability Calculator | `/tools/project-profitability` | Gross profit/margin, cost variance, rule-based risk indicator |
| BOQ Analysis Tool | `/tools/boq-analysis` | Category totals, budget variance, outlier-rate flags |
| Project Risk Assessment | `/tools/project-risk-assessment` | Schedule/Cost/Delivery/External risk scores + recommendations |
| Project Health Assessment | `/tools/project-health` | 9-dimension health dashboard from your own self-ratings |
| Construction KPI Calculator | `/tools/construction-kpi-calculator` | Standard EVM KPIs: CPI, SPI, CV, SV, EAC, productivity index |

Every tool now offers "Save to project workspace" for signed-in users, in
addition to the Build 2 email-report flow. Deliberate design choice: none of
these tools embeds a regional unit-cost or benchmark database, because
Papple has no verified, current source for one — every number shown is
calculated from what the visitor enters.

## The PGAN pages

| Page | Route | Purpose |
|---|---|---|
| PGAN hub | `/pgan` | Positioning, workflow summary, links into every other PGAN page |
| Expertise Areas | `/pgan/expertise` | Disciplines and industries, cross-linked to related Advisory services |
| How It Works | `/pgan/how-it-works` | The full client-request and specialist-application workflows, side by side |
| For Organizations | `/pgan/for-organizations` | Why organizations use a reviewed network instead of a self-service search |
| Specialists | `/pgan/experts` | Honest explanation of why there is no public specialist directory |
| Apply to Join | `/pgan/join` | Real specialist application form → `POST /api/pgan-apply` |

## Accounts, billing and the AI assistant

| Page | Route | Requires |
|---|---|---|
| Create account | `/signup` | `DATABASE_URL` |
| Sign in | `/signin` | `DATABASE_URL`, `AUTH_SECRET` |
| Account | `/account` | Signed in |
| Pricing | `/pricing` | — (public) |
| AI Advisory Assistant | `/assistant` | Signed in; real replies need `ANTHROPIC_API_KEY` |
| Project Workspace | `/workspace` | Signed in |
| Admin review queue | `/admin` | Signed in, `role: ADMIN` |
| Enterprise team | `/enterprise` | Signed in, in an `Organization` |
| Accept an invite | `/enterprise/accept-invite?token=…` | Invited email address (sign in or sign up with it) |

Joining an existing `Organization` is now self-service — an OWNER or
MANAGER sends an invite from `/enterprise` and the recipient accepts it at
the link above. There is still no self-service way to become an ADMIN, or
to create the very first `Organization` (and its first OWNER) — both are
set directly in the database (e.g. via Prisma Studio: `npx prisma studio`)
until an admin-invite and org-creation flow are built. This is a
deliberate, disclosed limitation, not an oversight.

## Deploying to Vercel + GitHub

1. Push this repository to GitHub:
   ```bash
   git init   # already initialized if you received this as a repo
   git add .
   git commit -m "Papple.net Build 1 + Build 2 + Build 3 + Build 4 + 4.1"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. In Vercel: **New Project → Import** the GitHub repo. Framework preset
   `Next.js` is auto-detected.
3. Set environment variables in **Project Settings → Environment Variables**
   for Production (and Preview if desired) — see `.env.example`. At minimum,
   set `NEXT_PUBLIC_SITE_URL` to your production domain.
4. Use `main` for production and `feature/*` branches for development —
   every PR gets an automatic Vercel Preview deployment.
5. Point your domain (papple.net) at the Vercel project via **Project
   Settings → Domains**.
6. If enabling Stripe: create a webhook endpoint in the Stripe dashboard
   pointing at `https://<your-domain>/api/billing/webhook`, subscribed to
   `checkout.session.completed` and `customer.subscription.deleted`, and set
   `STRIPE_WEBHOOK_SECRET` to its signing secret.

## Before going live — checklist

- [ ] Set `RESEND_API_KEY`, `LEADS_NOTIFICATION_EMAIL`, `LEADS_FROM_EMAIL` and verify the sending domain in Resend
- [ ] Set `DATABASE_URL` and `AUTH_SECRET` if real accounts are wanted at launch; run the "Turning on persistence" steps
- [ ] Set `ANTHROPIC_API_KEY` if the AI Advisory Assistant should give real answers rather than an honest "not configured" message
- [ ] Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (with an authorized redirect URI of `<your domain>/api/auth/callback/google` in the Google Cloud Console) if Google sign-in should be offered alongside email/password
- [ ] Set Stripe env vars and create Products/Prices in the Stripe dashboard if billing should be live (pricing is never hardcoded — see `src/data/pricing.ts`)
- [ ] Replace `/legal/privacy` and `/legal/terms` placeholder copy with counsel-reviewed policies — Build 4 adds real account data, so this matters more than before
- [ ] Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` if GA4 is your analytics provider (or swap `src/components/Analytics.tsx` for your own)
- [ ] Confirm every claim on `/about` and in the Founder section against verified sources — nothing here should ever be edited to add unverified stats, clients or awards
- [ ] Decide who reviews incoming PGAN applications and client requests — now doable at `/admin` for a user with `role: ADMIN` (set directly in the database)
- [ ] Run `npm run build` and `npm run lint` clean before deploying
- [ ] Review `next.config.mjs` Content-Security-Policy if you add third-party scripts (chat widgets, etc.) — the CSP is intentionally strict by default

## Rate limiting note

`src/lib/rate-limit.ts` is an in-memory limiter — effective per serverless
instance but not globally exact across Vercel's distributed functions. It
meaningfully slows naive/scripted abuse today, and is applied to sign-up,
sign-in (keyed by attempted email), organization invites, the AI assistant,
and workspace saves in addition to the Build 1/2/3 lead forms. For strict,
globally consistent limits at higher traffic, swap in `@upstash/ratelimit`
(Redis) at the relevant call sites.

## What's intentionally not in this build

Self-service Organization *creation* (adding members to an existing one is
now self-service — see "What's real" above) and any client/specialist-facing
PGAN match score. See "What's real vs. architecture-only in Build 4" above
for why. Everything else from the original four-build roadmap (corporate
website, Construction Intelligence tools, PGAN expert workflow, accounts,
subscriptions, AI assistant, enterprise/admin dashboards), plus the Build
4.1 gap-closing pass (organization invites, streaming AI, Google OAuth), is
now built, real where its environment variables are configured, and honest
about its current limits where they aren't.

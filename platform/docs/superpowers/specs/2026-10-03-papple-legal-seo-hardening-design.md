# PAPple Legal, SEO and hardening — design

Status: design approved by the owner in chat on 2026-10-03 ("Approve, build it"). Written spec awaiting owner review.

## Goal
Make the public surface launch-ready: legal pages the owner can have reviewed, search discovery that never leaks hidden or signed-in content, branded failure pages that never show server text, and a checklist of everything that needs the owner's own accounts.

## Honesty rules
- Legal text is a **draft for lawyer review**, not legal advice. Every legal page shows a "Draft — pending legal review" notice driven by one constant (`LEGAL.reviewed = false`). Flipping it is the owner's decision after review.
- Facts we do not know (registered address, licence number, governing law and forum, contact mailboxes) are `null` in `lib/legal.ts` and render as a visible `[to be confirmed by Papple World FZE LLC]` marker. Nothing is invented. A test fails if a page renders a placeholder while `reviewed` is true.
- Statements describe what the product does today: Papple is a marketplace, not the employer or a payment institution; payments are taken through Stripe; reviews are blind and two-way; disputes are ruled by Papple staff; the app sets only essential session cookies and analytics run only after explicit consent.

## 1. Legal pages (public, indexable)
`/terms`, `/privacy`, `/cookies`, `/marketplace-rules`, rendered by one `LegalPage` component from section data in `lib/legal-content.ts` (sections of `{id, title, body: string[]}`), so wording lives in data and is testable. Each page has title, description, canonical URL, "last updated" and version from `LEGAL`. A footer on the public layout links to all four plus `/status`.

## 2. Discovery
- `lib/seo.ts`: `siteUrl(env)` (from `NEXT_PUBLIC_SITE_URL`, falling back to `https://papple.net`, trailing slash stripped), `buildRobots(base)`, `buildSitemap(base, providers, services)` as pure functions.
- `app/robots.ts`: allows `/`, disallows `/admin`, `/api`, and every prefix in `route-gate` (`/dashboard`, `/settings`, `/projects`, `/contracts`, `/messages`, `/notifications`, `/profile`, `/onboarding`, `/services` exact is a manager page), points to `/sitemap.xml`. The disallow list is derived from `route-gate` so the two cannot drift.
- `app/sitemap.ts`: static pages + `/p/<slug>` and `/services/<slug>` read from the whitelisted `public_provider_cards` and `public_service_cards` views through the anonymous-capable client, so hidden or suspended items are absent by RLS. Capped at 5,000 URLs per kind, ordered newest first. A database failure yields the static pages only, never an error.
- The `(app)` layout sets `robots: { index: false, follow: false }`.

## 3. Resilience pages
`app/not-found.tsx` (real 404 status), `app/error.tsx` (client boundary with Try again; shows a generic message and the error `digest` only, never `error.message`), `app/global-error.tsx` (renders its own html/body). `/status` returns a static "operational" page with no secrets, and `/.well-known/security.txt` is a route handler built from `LEGAL.securityContact` (placeholder until confirmed, so the file states it is unconfirmed rather than pointing to a fake mailbox).

## 4. Consent
No change to the analytics banner. The cookies page documents it. Test: the banner stays hidden without a PostHog key.

## 5. Hardening audit (findings become tests or checklist items)
- Every server action and route handler that writes is checked for a `throttle` call or an explicit reason it needs none; gaps found are fixed with a RED→GREEN test where a rule exists, otherwise listed in the checklist.
- `buildSecurityHeaders` is confirmed to apply to the new routes (robots, sitemap, security.txt go through `proxy.ts`).
- `docs/launch-checklist.md`: Stripe Connect and webhook events (`refund.created`, `refund.updated`), separate Vercel project for `platform/`, domains and DNS, Supabase production project, backups and PITR, Resend domain, R2 bucket and CORS, MFA for admins, legal review, security contact mailbox. Each item names who does it.

## Out of scope
New CSP rules, new rate-limit rules without a found gap, cookie-consent categories beyond analytics, translated legal text, a blog.

## Review focus
Hidden or suspended provider appearing in the sitemap; sitemap failure returning 500; robots disallow list drifting from route-gate; a legal page with a placeholder and `reviewed: true`; `error.tsx` leaking `error.message`; `/services` manager page indexed while `/services/<slug>` is not; sitemap URLs using a wrong or trailing-slash base; `not-found` returning 200.

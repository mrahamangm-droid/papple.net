# PAPple Legal, SEO and hardening Implementation Plan

> Execution: superpowers:executing-plans (inline), chosen by the owner's delegation ("do it for me").

**Goal:** Launch-ready public surface: legal pages, sitemap/robots, branded failure pages, hardening audit, launch checklist.
**Architecture:** Pure builders in `lib/` (tested with vitest), thin Next route files on top, wording in data files.
**Tech Stack:** Next.js App Router, vitest, Playwright anonymous spec.
**Spec:** docs/superpowers/specs/2026-10-03-papple-legal-seo-hardening-design.md

## Global Constraints
- Legal text is draft; unknown facts are `null` and render the marker `[to be confirmed by Papple World FZE LLC]`. Never invent address, licence, law, mailbox.
- Errors never show `error.message`. Sitemap failure returns static pages only.
- Disallow list derived from `route-gate`.

## Review Focus
Hidden provider in sitemap; sitemap 500 on DB failure; robots drift from route-gate; placeholder with reviewed=true; error.tsx leaking message; /services manager indexed; base URL trailing slash; not-found status 200.

### Task 1: Legal data, builders, pages
Files: Create `src/lib/legal.ts`, `src/lib/legal-content.ts`, `src/components/LegalPage.tsx`, `src/components/PublicFooter.tsx`, `src/app/(public)/{terms,privacy,cookies,marketplace-rules}/page.tsx`, `src/app/(public)/layout.tsx`; tests `legal.test.ts`.
Interfaces — Produces: `LEGAL {reviewed:boolean, version:string, updated:string, address|licence|governingLaw|contactEmail|securityContact: string|null}`, `PLACEHOLDER`, `show(v:string|null):string`, `unresolvedPlaceholders(text):boolean`, `LEGAL_PAGES: Record<slug,{title,description,sections}>`, `LEGAL_SLUGS`.
- [ ] RED tests: show(null)=PLACEHOLDER; show("x")="x"; every page has ≥4 sections, unique ids, non-empty bodies; no page text contains "TODO"/"lorem"; if LEGAL.reviewed then no placeholder anywhere; privacy mentions Stripe, Supabase, Resend; terms states Papple is not the employer and does not hold funds.
- [ ] GREEN implement; pages render via LegalPage with metadata + canonical.
### Task 2: SEO builders, robots, sitemap, noindex
Files: Create `src/lib/seo.ts`, `seo.test.ts`, `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/(app)/layout.tsx`; Modify `lib/route-gate.ts` (export `PROTECTED_PREFIXES`, `PROTECTED_EXACT`).
Produces: `siteUrl(raw?:string):string`, `buildRobots(base)`, `buildSitemap(base,{providers,services})`.
- [ ] RED tests: siteUrl strips trailing slash, defaults https://papple.net, rejects non-http; robots disallows every gate prefix + /api + /admin and "/services" exact only; sitemap includes static pages + provider/service URLs, drops invalid slugs, dedupes, caps 5000; sitemap never includes gated paths.
- [ ] GREEN; `sitemap.ts` queries views via server client, try/catch → static only.
### Task 3: Failure pages, status, security.txt
Files: Create `src/app/not-found.tsx`, `error.tsx`, `global-error.tsx`, `src/app/(public)/status/page.tsx`, `src/app/.well-known/security.txt/route.ts`, `src/lib/security-txt.ts` + test.
Produces: `buildSecurityTxt(contact:string|null, now:Date):string`.
- [ ] RED: placeholder contact → states unconfirmed, no `mailto:` invented; real contact → `Contact: mailto:..`, `Expires:` within 1 year RFC3339, `Canonical:` not required.
- [ ] GREEN; error pages show digest only.
### Task 4: Hardening audit, e2e, docs
- [ ] Audit throttle coverage on writing actions/routes; fix gaps with RED→GREEN.
- [ ] e2e: legal pages 200 + headings; robots.txt/sitemap.xml 200; unknown path 404 with branded copy; security.txt 200.
- [ ] `docs/launch-checklist.md`, architecture + README updates.
- [ ] Full suite: vitest, tsc, eslint, next build, playwright anonymous.

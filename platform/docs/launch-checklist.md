# PAPple launch checklist

Owner = Eng Habib / Papple World FZE LLC. "Claude" items are already done in code.

## Legal (owner + lawyer)
- [ ] A UAE lawyer reviews `/terms`, `/privacy`, `/cookies`, `/marketplace-rules` (text lives in `apps/web/src/lib/legal-content.ts`). Owner.
- [ ] Fill every `null` in `apps/web/src/lib/legal.ts`: `address`, `licence`, `governingLaw`, `contactEmail`, `securityContact`. Owner.
- [ ] Only then set `LEGAL.reviewed = true` (removes the draft banner; a test forbids this while placeholders remain). Owner.
- [ ] Create the mailboxes you publish (support, security). Owner.
- [ ] Launch blocker: `/.well-known/security.txt` has no `Contact:` line until `securityContact` is set (RFC 9116 requires one). Owner.

## Payments
- [ ] Enable Stripe Connect for the UAE platform account. Owner.
- [ ] Add `refund.created` and `refund.updated` to webhook endpoint `we_1UM8HXChhnG4ffxfhQtMpBbd` (https://papple.net/api/webhooks/stripe). Owner (or approve Claude to do it).
- [ ] Put `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` into the app environment yourself. Owner.
- [ ] Run one real test-mode contract, milestone payment and refund end to end. Owner + Claude.

## Hosting
- [ ] Create a separate Vercel project for the `platform/` app (the root project serves papple.net). Owner.
- [ ] Apply the root `tsconfig.json` exclude (`"exclude": ["node_modules", "platform"]`) so the root build stops type-checking `platform/`. Owner (or approve Claude).
- [ ] Pay the overdue Vercel invoice. Owner.
- [ ] Set `NEXT_PUBLIC_SITE_URL` so `sitemap.xml` and `robots.txt` use the production origin. Owner.
- [ ] Domain, DNS, HTTPS. Owner.

## Data
- [ ] Production Supabase project; apply migrations `0001`–`0028` in order. Owner + Claude.
- [ ] Turn on backups and point-in-time recovery. Owner.
- [ ] Create the first admin and enrol their second factor (admin screens need aal2). Owner.
- [ ] Resend: verify the sending domain (SPF, DKIM). Owner.
- [ ] Cloudflare R2: bucket, access keys, CORS for uploads. Owner.
- [ ] Upstash Redis for rate limits in production (the in-memory limiter is per instance only). Owner.

## Verified in code (Claude)
- [x] Nonce CSP, HSTS, nosniff, frame-ancestors none on every route (`proxy.ts`).
- [x] Rate limits on auth, search, uploads, signed downloads, proposals, messages, reports, contracts, checkout, disputes, reviews, verification requests.
- [x] `robots.txt` blocks signed-in areas; `sitemap.xml` lists only public views; signed-in pages are `noindex`.
- [x] Branded 404, error and global error pages that never show server text.
- [x] `/.well-known/security.txt` never publishes an unconfirmed contact.

## Not yet verified
- Signed-in admin screens with a real second factor, a real Stripe refund, and the Verified badge on live pages need a staging project with real credentials.

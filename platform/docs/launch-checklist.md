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

## Plans and billing
- [ ] Enable Stripe Billing on the platform account and turn on the customer portal (cancel, update card, invoices). Owner.
- [ ] In Stripe create one recurring Price per paid plan (Professional Plus, Business), then store each id on the plan (`plans.stripe_price_id`, SQL editor or the Plans page when it supports it). Plans without a price cannot be bought. Owner.
- [ ] Add `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted` to the platform webhook endpoint `we_1UM8HXChhnG4ffxfhQtMpBbd`. Owner (or approve Claude to do it).
- [ ] Set `billing.grace_days` (default 7) in Admin settings: how long a failed payment keeps paid features. Owner.
- [ ] Run one test-mode subscription: buy, see the plan change, fail a payment with a Stripe test card, cancel in the portal. Owner + Claude. Webhooks alert (Sentry) on `unknown_org`, `unknown_plan` and `conflict` outcomes.

## Invoicing
- [ ] Have an accountant review the invoice template (`INVOICE` in `lib/invoices/present.ts`) against UAE tax invoice rules, then set `INVOICE.reviewed = true`. Until then every invoice says it has not been reviewed and is titled "Invoice", never "Tax Invoice". Owner.
- [ ] Decide how Papple's own commission and client fee are invoiced (not built yet; provider invoices cover only the milestone price). Owner + accountant.

## AI assistant (optional)
- [ ] Create an Anthropic API key and paste `ANTHROPIC_API_KEY` into the app environment yourself; optionally set `AI_MODEL`. Owner.
- [ ] Set a spending limit in the Anthropic console as a second safety net. Owner.
- [ ] Review the per-plan monthly allowance (`ai.monthly_message_limits`) and the daily cap (`ai.daily_request_cap`) in Admin → Settings. Owner.
- [ ] Turn on the `ai.assistant` flag only after the two items above. It is off by default. Owner.
- [ ] Have the lawyer review the "AI assistant" paragraph of the privacy policy. Owner.

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
- [x] Rate limits on auth, search, uploads, signed downloads, proposals, messages, reports, contracts, checkout, disputes, reviews, verification requests, billing.
- [x] `robots.txt` blocks signed-in areas; `sitemap.xml` lists only public views; signed-in pages are `noindex`.
- [x] Branded 404, error and global error pages that never show server text.
- [x] `/.well-known/security.txt` never publishes an unconfirmed contact.

## Not yet verified
- Signed-in admin screens with a real second factor, a real Stripe refund, and the Verified badge on live pages need a staging project with real credentials.

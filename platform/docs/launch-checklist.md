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
- [ ] In Stripe create one monthly recurring Price per paid plan: Professional Plus USD 29.99, Business USD 49.99, Enterprise USD 99.99 (migration 0046 cleared the old ids). Store each id on the plan (`plans.stripe_price_id`, SQL editor or the Plans page when it supports it). Plans without a price cannot be bought. The 30-day free trial is added by the app at checkout (setting `billing.trial_days`); do not add a trial on the Stripe Price itself. Owner.
- [ ] Add `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted` to the platform webhook endpoint `we_1UM8HXChhnG4ffxfhQtMpBbd`. Owner (or approve Claude to do it).
- [ ] Set `billing.grace_days` (default 7) in Admin settings: how long a failed payment keeps paid features. Owner.
- [ ] Run one test-mode subscription: buy, see the plan change, fail a payment with a Stripe test card, cancel in the portal. Owner + Claude. Webhooks alert (Sentry) on `unknown_org`, `unknown_plan` and `conflict` outcomes.

## Invoicing
- [ ] Have an accountant review the invoice template (`INVOICE` in `lib/invoices/present.ts`) against UAE tax invoice rules, then set `INVOICE.reviewed = true`. Until then every invoice says it has not been reviewed and is titled "Invoice", never "Tax Invoice". Owner.
- [ ] Decide how Papple's own commission and client fee are invoiced (not built yet; provider invoices cover only the milestone price). Owner + accountant.

## CRM
- [ ] Review the per-plan contact limit (platform setting `limits.crm_contacts`: 100 / 1,000 / 10,000 / unlimited on Enterprise; like the other `limits.*` settings it is changed in the database, not in Admin → Settings). Owner.
- [ ] Have the lawyer review the import attestation wording shown above the CSV import and the "CRM data" paragraph of the privacy policy (contacts are the organization's own data; Papple is a processor for them). Owner.
- [ ] CRM email stays off (feature flag `crm.email`, default off) until every item below is done. Owner.
  - [ ] Verify the sending domain in Resend (SPF, DKIM, DMARC) and set `EMAIL_FROM` to an address on it. Messages show the organization's legal name followed by "via PAPple" in front of that address.
  - [ ] Set `CRM_UNSUBSCRIBE_SECRET` (at least 16 random characters, kept secret; rotating it invalidates unsubscribe links already sent) and `NEXT_PUBLIC_SITE_URL`. Without them nothing is sent.
  - [ ] In Resend add a webhook to `https://papple.net/api/webhooks/resend` for `email.bounced` and `email.complained`, and put its signing secret in `RESEND_WEBHOOK_SECRET`. Until then bounces and spam complaints are not recorded automatically.
  - [ ] Know the limits of the log: a message whose delivery could not be confirmed is shown as `unknown` and counts toward the cap; a message stuck as `queued` (server crash mid-send) is not cleaned up automatically yet. Owner.
  - [ ] Review the daily cap `limits.crm_emails_per_day` (10 / 50 / 200 / 1,000 by plan; a database setting like the other `limits.*`).
  - [ ] Have the lawyer review the email footer wording (`buildEmailText` in `lib/crm/email.ts`) and the consent basis options against UAE and any recipient-country rules. Papple records the sender's stated basis; it cannot verify it.
  - [ ] Send one test message to your own address and check the footer, the Reply-To, the unsubscribe confirmation page and that a second send is refused after unsubscribing. Owner + Claude.

## Team workspace
- [ ] Review the per-plan seat limit (platform setting `limits.team_seats`: 1 / 5 / 25 / unlimited on Enterprise; members plus pending invites; a database setting like the other `limits.*`) and the daily invite cap `limits.team_invites_per_day` (20). Organizations already over a limit keep their members but cannot add more. Owner.
- [ ] Email invitations are off (feature flag `team.email_invites`, default off). The invite link always works, so the flag is optional. To enable it: set `RESEND_API_KEY` and `EMAIL_FROM` (verified Resend domain, same as CRM email) and `NEXT_PUBLIC_SITE_URL`, then turn the flag on in Admin → Settings. Send a test invite to your own address and check the wording. Owner + Claude.
- [ ] Release gate: in the hosted Supabase project turn "Confirm email" ON and "Secure email change" ON, and enable only sign-in providers that report verified emails. Invitations trust the confirmed address, so with confirmation off anyone could sign up as the invited address and join. Owner.
- [ ] `NEXT_PUBLIC_SITE_URL` is required for invite links; without it nobody can be invited.
- [ ] Have the lawyer glance at the invitation email wording (`buildInviteEmail` in `lib/team/email.ts`) and the privacy policy: team members can see each other's sign-in email addresses. Owner.
- [ ] Know the limits: there is no activity log of who invited or removed whom (planned for a later slice); a member who is removed keeps nothing, but work they created stays with the organization.
- [ ] Run one real invite end to end in staging: invite a second address, sign in as it, accept, change the role, remove. Owner + Claude.

## PGAN credentials
- [ ] Have the lawyer review the public wording (`CHECKED_COPY` in `lib/credentials/present.ts`): "Checked by PAPple" means a reviewer looked at the evidence supplied, not that Papple certifies the credential, the issuer or the person. Owner.
- [ ] Decide who reviews credential checks and how (Admin → Credential checks; needs an admin with a second factor). Agree what counts as acceptable evidence per type (licence, degree, certification) so reviews are consistent. Owner.
- [ ] Review the per-plan credential limit (`limits.credentials`: 10 / 30 / 100 / unlimited on Enterprise; a database setting like the other `limits.*`). Owner.
- [ ] Know the limits: evidence is a link (no file upload yet); no automatic registry checks; no expiry reminder emails; checked credentials past their expiry show as Expired automatically.
- [ ] Review one real check end to end in staging: add a credential with a link, request a check, approve it as an admin, see the badge on the public profile, edit it and see it return to self-declared. Owner + Claude.

## Talent pools
- [ ] Review the per-plan limits (database settings like the other `limits.*`): `limits.talent_pools` (1 / 3 / 10 / unlimited), `limits.pool_members` per pool (25 / 100 / 500 / unlimited) and `limits.project_invites_per_day` (5 / 25 / 100 / unlimited, rolling 24 hours, per organization). Owner.
- [ ] Have the lawyer review the privacy policy wording for pools: an organization keeps private notes and tags about professionals who have a public profile; the professional cannot see them or opt out except by making their profile private. Owner.
- [ ] Decide whether professionals should be told they were added to a pool (today they are not; they only see invitations). Owner.
- [ ] Know the limits: invitations are in-app notifications only (no email yet); only open projects can invite; one invitation per project and professional; no pool sharing, bulk invite or auto-matching.
- [ ] Send one test invitation between two staging organizations and check the notification and the Invitations page. Owner + Claude.

## Hiring analytics
- [ ] Review the per-plan history window (`limits.analytics_days`: 30 / 90 / 365 / 365 on Enterprise; a database setting like the other `limits.*`). Owner.
- [ ] Have an accountant look at the Money table and its definitions on `/analytics` (committed = price of accepted contracts only, paid = milestone amounts before fees and not refunded, fees = PAPple client fees, refunded = amount plus fee that went back; nothing is added across currencies). Owner.
- [ ] Know the limits: buyer-side hiring only (no provider earnings view yet); no CSV export or emailed reports; numbers are computed live from contracts, payments and invitations, with a refund still in progress counted as paid until it completes; refunds are dated by when they were completed; months are UTC and the monthly table shows the latest 13; there are no indexes tuned for very large organizations yet.
- [ ] Open `/analytics` for one staging organization with real contracts and check each figure against the Contracts page. Owner + Claude.

## Contract work and files
- [ ] Review the per-plan limits (database settings like the other `limits.*`): `limits.tasks_per_contract` (50 / 200 / 1,000 / unlimited), `limits.files_per_contract` (20 / 100 / 500 / unlimited) and `limits.storage_mb` per organization (100 MB / 1 GB / 10 GB / unlimited; pending uploads count). Owner.
- [ ] Know the limits: uploaded files are checked for type, exact size and leading bytes but are **not scanned for viruses**, and for five minutes after upload the uploader's own signed URL could still replace the bytes with others of the same size and type; an upload that was never finished stays as a pending row (visible only to its own organization, who can delete it) and there is no automatic cleanup yet; the other party can read only what is shared, and only read; time records are never shared; no folders, versions or task dependencies yet; the list pages are not paginated.
- [ ] On staging with two test accounts (client and professional): create a private task and a shared task as the professional, upload one private and one shared file, and confirm the client sees only the shared items and can download only the shared file. Owner + Claude.

## API access
- [ ] Review the per-plan active key limit (`limits.api_keys`: 0 / 0 / 2 / 10 for default / Professional+ / Business / Enterprise; 0 means no API access; a database setting like the other `limits.*`). Owner.
- [ ] Decide whether admins (not only owners) may create and revoke keys. Today owners only, which is the safer default. Owner.
- [ ] Know the limits: read-only; four endpoints (projects, proposals, contracts, analytics); keys are per organization and have no scopes, expiry or IP allow-list yet; cover letters and commission rates are never returned; rate limits are 60 requests a minute per key and 120 per caller address, counted per server instance until a shared limiter is configured.
- [ ] Configure the shared rate limiter (Upstash) before announcing the API: without it each server instance counts on its own, so the real limits are multiplied by the number of instances. Owner + Claude.
- [ ] Know the key rules: a key stops when the plan's `limits.api_keys` no longer covers it (0 = none, or only the newest N keys work after a downgrade), and pauses while the person who created it is not an owner (it works again if they are).
- [ ] Publish a short public developer page (base URL, bearer header, the four endpoints, pagination, error codes) once the domain is final; the owner page shows a usage example with a placeholder domain. Owner + Claude.
- [ ] Create a key for one staging organization and check each endpoint against the Projects, Contracts and Analytics pages. Owner + Claude.

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
- [ ] Production Supabase project; apply migrations `0001`–`0039` in order. Owner + Claude.
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

# PAPple Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Sub-project 1 of PAPple: a secure multi-tenant Next.js + Supabase foundation (auth, tenancy, RBAC, admin-editable config, audit, security baseline, CI/CD) that later marketplace, payments, admin, SaaS and AI sub-projects build on.

**Architecture:** Next.js App Router app in `apps/web`; Postgres schema and RLS in `supabase/migrations`, tested with pgTAP; every business table carries `org_id` and is isolated by RLS using `SECURITY DEFINER` helper functions; privileged actions go through one audited server-only wrapper; CI reuses `saas-platform-kit@v1`.

**Tech Stack:** Next.js (App Router), TypeScript strict, Tailwind, Zod, Vitest, Playwright, Supabase (Postgres, Auth, `@supabase/ssr`), pgTAP, Cloudflare R2 (S3 API via `@aws-sdk/client-s3` + presigner), Upstash Redis (optional), Sentry, PostHog, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-papple-foundation-design.md`

## Global Constraints

- Brand strings: "Papple — Global Professional Marketplace & AI Business Platform"; company "Papple World FZE LLC".
- Papple is a technology platform; never an employer or recruitment agency; never a payment institution; never holds customer funds.
- Money is integer minor units; rates are basis points. Launch seed values only: Professional commission 500 bps, Client fee 200 bps, Professional Plus 999 cents/month USD, Business 1999 cents/month USD, Enterprise custom, Free Client plan. No price, rate or limit is hardcoded outside `supabase/seed.sql`.
- RLS enabled on every `public` table; default deny; CI fails if any table lacks RLS or a policy.
- No secrets in the repo; `.env.example` lists names only.
- TypeScript `strict: true`; Zod validation at every server boundary.
- Migrations are forward-only; each has a paired undo note in `supabase/migrations/README.md`.
- Original design; no competitor branding or code.

## Review Focus

- A user with two org memberships must see only the org they select and never leak rows across orgs (test in Task 3).
- A removed member keeps a valid session JWT but must lose access immediately (test in Task 3: RLS reads memberships live, not JWT claims).
- Open-redirect via `next=https://evil.example` on sign-in must fall back to `/dashboard` (Task 9).
- Oversized, mislabeled-MIME or double-extension uploads must be rejected (Task 10).
- Replayed or tampered webhook payload must be rejected and must not process twice (Task 11).

---

### Task 1: Repository scaffold and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `apps/web/` (Next.js app), `apps/web/vitest.config.ts`, `.gitignore`, `.env.example`, `.editorconfig`, `README.md`
- Test: `apps/web/src/lib/brand.test.ts`

**Interfaces:**
- Produces: `export const BRAND = { name: "Papple", tagline: "Global Professional Marketplace & AI Business Platform", company: "Papple World FZE LLC" }` in `apps/web/src/lib/brand.ts`; scripts `lint`, `typecheck`, `test`, `build` at root.

- [ ] **Step 1: Write failing test** `brand.test.ts`: `expect(BRAND.company).toBe("Papple World FZE LLC")` and tagline equals the string above.
- [ ] **Step 2:** Run `pnpm -C apps/web test` → FAIL (module missing).
- [ ] **Step 3:** Scaffold Next.js (TS strict, Tailwind, ESLint) with `pnpm create next-app`, add Vitest, implement `brand.ts`. Ensure `.gitignore` ignores `.env*` except `.env.example`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → all PASS.
- [ ] **Step 5:** Commit `chore: scaffold web app and tooling`.

### Task 2: Typed environment validation

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Test: `apps/web/src/lib/env.test.ts`

**Interfaces:**
- Produces: `parseServerEnv(raw: Record<string, string | undefined>): ServerEnv` (throws `Error` naming each missing/invalid key, never printing values); `parsePublicEnv(raw): PublicEnv`. Keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `UPSTASH_REDIS_REST_URL?`, `UPSTASH_REDIS_REST_TOKEN?`, `SENTRY_DSN?`, `NEXT_PUBLIC_POSTHOG_KEY?`.

- [ ] **Step 1:** Tests: missing `SUPABASE_SERVICE_ROLE_KEY` throws message containing that key name and not any provided secret value; valid input returns typed object; optional keys may be absent.
- [ ] **Step 2:** Run test → FAIL.
- [ ] **Step 3:** Implement with Zod; error formatter lists key names only.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `feat: validated environment config`.

### Task 3: Identity and tenancy schema with RLS

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/0001_identity_tenancy.sql`, `supabase/tests/001_tenancy.test.sql`, `scripts/check-rls-coverage.sql`
- Modify: `supabase/migrations/README.md` (undo note)

**Interfaces:**
- Produces tables: `profiles(id uuid pk → auth.users, display_name text, persona text, locale text, status text)`, `organizations(id, type, name, status, created_by)`, `memberships(user_id, org_id, role)` with `role in ('owner','admin','member','viewer')`, `platform_roles(user_id, role in ('admin','support'))`. Functions (all `SECURITY DEFINER STABLE`, `set search_path = public`): `is_member(p_org uuid) returns boolean`, `has_org_role(p_org uuid, p_roles text[]) returns boolean`, `is_platform_admin() returns boolean`. RPC `create_organization(p_name text, p_type text) returns uuid` (creates org + owner membership atomically for `auth.uid()`).

- [ ] **Step 1:** Write pgTAP tests: (a) user A cannot `select` org B's `organizations`/`memberships`; (b) A cannot insert a membership into org B; (c) `viewer` cannot update org; `owner` can; (d) user in two orgs sees exactly both and no third; (e) after deleting A's membership, A's same session sees zero rows; (f) `platform_roles` not writable by authenticated users; (g) `create_organization` makes caller owner.
- [ ] **Step 2:** Run `supabase test db` → FAIL.
- [ ] **Step 3:** Write migration: tables, RLS enabled + policies using the helper functions, indexes on `memberships(user_id)`, `memberships(org_id)`, trigger creating `profiles` row on `auth.users` insert. Write `check-rls-coverage.sql` returning rows for any `public` table with RLS off or zero policies.
- [ ] **Step 4:** Run `supabase db reset && supabase test db` → PASS; run coverage script → zero rows.
- [ ] **Step 5:** Commit `feat(db): identity, tenancy and RLS`.

### Task 4: Configuration layer (plans, settings, flags) and money utils

**Files:**
- Create: `supabase/migrations/0002_config.sql`, `supabase/seed.sql`, `supabase/tests/002_config.test.sql`, `apps/web/src/lib/money.ts`, `apps/web/src/lib/settings.ts`
- Test: `apps/web/src/lib/money.test.ts`, `apps/web/src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `is_platform_admin()` (Task 3).
- Produces tables `plans`, `platform_settings`, `settings_history`, `feature_flags` (columns per spec §6.3). `money.ts`: `applyBps(amountMinor: number, bps: number): number` (round half up, integer only, throws on non-integer or negative); `splitCommission(amountMinor: number, professionalBps: number, clientBps: number): { clientFeeMinor: number; professionalFeeMinor: number }`. `settings.ts`: `getSetting<T>(key: string, schema: ZodType<T>): Promise<T>` (60 s TTL cache, injectable loader for tests), `getCommissionBps(): Promise<{ professional: number; client: number }>`, `isFlagEnabled(key: string, orgId?: string): Promise<boolean>`.

- [ ] **Step 1:** Tests: `applyBps(10000, 500) === 500`; `applyBps(999, 500) === 50` (49.95 rounds up); `splitCommission(10000, 500, 200)` → `{ clientFeeMinor: 200, professionalFeeMinor: 500 }`; non-integer input throws; cache returns stale value within TTL then refreshes after; pgTAP: non-admin `update platform_settings` affects 0 rows, admin update writes a `settings_history` row; seed contains `commission.professional_bps=500`, `commission.client_bps=200`, plans `free`, `professional_plus` (999), `business` (1999), `enterprise` (price null).
- [ ] **Step 2:** Run both suites → FAIL.
- [ ] **Step 3:** Implement migration (history trigger), seed, `money.ts`, `settings.ts`.
- [ ] **Step 4:** Run suites → PASS.
- [ ] **Step 5:** Commit `feat: admin-editable config layer`.

### Task 5: Audit log and admin action wrapper

**Files:**
- Create: `supabase/migrations/0003_audit.sql`, `supabase/tests/003_audit.test.sql`, `apps/web/src/lib/audit.ts`, `apps/web/src/lib/admin-action.ts`
- Test: `apps/web/src/lib/audit.test.ts`, `apps/web/src/lib/admin-action.test.ts`

**Interfaces:**
- Consumes: `is_platform_admin()`; Supabase service client factory `createServiceClient(): SupabaseClient` (server-only, defined here in `apps/web/src/lib/supabase/service.ts`).
- Produces: table `audit_log` (insert-only; no update/delete policy); `writeAudit(entry: { actorId: string | null; orgId?: string; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown; requestId: string; ip?: string }): Promise<void>` (redacts keys matching `/password|token|secret|key/i`, hashes IP); `adminAction<I, O>(opts: { name: string; input: ZodType<I>; handler: (input: I, ctx: { userId: string }) => Promise<O> }): (raw: unknown) => Promise<O>` (rejects non-admins with `ForbiddenError`, invalid input with `ValidationError`, always audits success and failure).

- [ ] **Step 1:** Tests: update/delete on `audit_log` fails even for admin; `writeAudit` redacts `{password:"x", nested:{apiKey:"y"}}`; `adminAction` as non-admin throws `ForbiddenError` and writes a denied audit row; invalid input throws `ValidationError` before handler runs.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement migration, service client, `writeAudit`, `adminAction`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: audit log and admin action wrapper`.

### Task 6: Authentication, onboarding and MFA

**Files:**
- Create: `apps/web/src/lib/supabase/{server,browser}.ts`, `apps/web/src/middleware.ts`, `apps/web/src/app/(auth)/{signup,signin,reset,mfa}/page.tsx`, `apps/web/src/app/(auth)/onboarding/page.tsx`, `apps/web/src/app/api/onboarding/route.ts`, `apps/web/src/lib/onboarding.ts`
- Test: `apps/web/src/lib/onboarding.test.ts`, `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `create_organization` RPC (Task 3), `parsePublicEnv` (Task 2).
- Produces: `onboardingSchema = z.object({ persona: z.enum(["client","professional","agency","enterprise","pgan_expert"]), orgName: z.string().trim().min(2).max(120) })`; `completeOnboarding(userId: string, input: z.infer<typeof onboardingSchema>): Promise<{ orgId: string }>`; `getSessionUser(): Promise<{ id: string; email: string } | null>` in `supabase/server.ts`. `pgan_expert` persona is accepted but marks profile `status='pending_verification'`; persona never grants permissions.

- [ ] **Step 1:** Tests: schema rejects `persona:"admin"`; `completeOnboarding` creates one org and owner membership and is idempotent on retry; e2e: sign up → verify (Inbucket local mail) → onboarding → lands on `/dashboard`; TOTP enrol then sign-in requires code.
- [ ] **Step 2:** Run unit then e2e → FAIL.
- [ ] **Step 3:** Implement `@supabase/ssr` clients, session-refreshing middleware, auth pages, onboarding endpoint (Zod-validated, rate-limited via Task 8 once available), TOTP enrol/challenge using Supabase MFA APIs.
- [ ] **Step 4:** Run unit and e2e → PASS.
- [ ] **Step 5:** Commit `feat: auth, onboarding and MFA`.

### Task 7: RBAC and role-gated dashboards

**Files:**
- Create: `apps/web/src/lib/rbac.ts`, `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/admin/page.tsx`, `apps/web/src/components/shell/AppShell.tsx`, `apps/web/src/components/ui/{Button,Card,Input,Table,Dialog,Toast}.tsx`
- Test: `apps/web/src/lib/rbac.test.ts`, `apps/web/e2e/rbac.spec.ts`

**Interfaces:**
- Consumes: `getSessionUser` (Task 6), RLS helpers (Task 3).
- Produces: `type Capability = "org.read" | "org.manage" | "members.manage" | "platform.admin"`; `can(ctx: { orgRole?: "owner"|"admin"|"member"|"viewer"; platformRole?: "admin"|"support" }, cap: Capability): boolean`; `requireCapability(cap: Capability, orgId?: string): Promise<{ userId: string; orgId?: string }>` (redirects unauthenticated to `/signin`, throws 403 otherwise).

- [ ] **Step 1:** Tests: matrix — owner/admin have `org.manage`; member/viewer do not; only `platform_roles.admin` has `platform.admin`; persona `professional` without membership role cannot reach `/admin`; e2e: each persona sees only its own nav; anonymous → `/signin`; non-admin GET `/admin` → 403.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `rbac.ts`, shell, original design tokens in `tailwind.config.ts`, accessible primitives (labels, focus rings, keyboard dialog).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: RBAC and role-gated shell`.

### Task 8: Rate limiting

**Files:**
- Create: `apps/web/src/lib/ratelimit.ts`
- Test: `apps/web/src/lib/ratelimit.test.ts`

**Interfaces:**
- Produces: `interface RateLimiter { check(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }> }`; `createRateLimiter(env: ServerEnv): RateLimiter` (Upstash when configured, else in-memory); `enforce(limiter: RateLimiter, key: string, rule: { limit: number; windowSec: number }): Promise<void>` throwing `RateLimitError` (maps to HTTP 429 with `Retry-After`). Rules for auth: 5/min per IP+email, onboarding 10/min per user.

- [ ] **Step 1:** Tests: 5 calls allowed, 6th rejected with `resetSec > 0`; window expiry re-allows (fake timers); distinct keys independent.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement both backends behind the interface. **Step 4:** Run → PASS. Wire `enforce` into onboarding and auth routes.
- [ ] **Step 5:** Commit `feat: rate limiting`.

### Task 9: Security headers, CSP and safe redirects

**Files:**
- Create: `apps/web/src/lib/security-headers.ts`, `apps/web/src/lib/safe-redirect.ts`
- Modify: `apps/web/next.config.ts`, `apps/web/src/middleware.ts`
- Test: `apps/web/src/lib/safe-redirect.test.ts`, `apps/web/src/lib/security-headers.test.ts`

**Interfaces:**
- Produces: `safeRedirect(next: string | null | undefined, fallback = "/dashboard"): string` (allows only same-origin paths beginning with a single `/`); `buildSecurityHeaders(nonce: string): Record<string, string>` including CSP (`default-src 'self'`, nonce-based scripts, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

- [ ] **Step 1:** Tests: `safeRedirect("https://evil.example")`, `"//evil.example"`, `"/\\evil.example"`, `"javascript:alert(1)"` → `"/dashboard"`; `"/projects?x=1"` preserved; headers contain `frame-ancestors 'none'` and nonce.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and apply in middleware. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: security headers and safe redirects`.

### Task 10: Private file storage (R2) and upload validation

**Files:**
- Create: `apps/web/src/lib/storage.ts`, `apps/web/src/lib/file-validation.ts`, `apps/web/src/app/api/uploads/sign/route.ts`
- Test: `apps/web/src/lib/file-validation.test.ts`, `apps/web/src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `requireCapability` (Task 7), `enforce` (Task 8).
- Produces: `validateUpload(meta: { name: string; size: number; declaredMime: string; head: Uint8Array }): { ok: true; ext: string; mime: string } | { ok: false; reason: string }` (allowlist: pdf, png, jpg, webp, docx, xlsx; max 10 MB; magic bytes must match declared MIME; rejects double extensions like `a.pdf.exe`); `objectKey(orgId: string, fileId: string, ext: string): string` → `orgs/<orgId>/<fileId>.<ext>`; `signDownloadUrl(key: string, ttlSec = 300): Promise<string>`; `signUploadUrl(key: string, mime: string, ttlSec = 300)`. Download endpoint must verify the caller is a member of the key's `orgId`.

- [ ] **Step 1:** Tests: PDF bytes labeled `image/png` rejected; `invoice.pdf.exe` rejected; 10 MB + 1 rejected; valid PNG accepted; `objectKey` always prefixed by org id; signed URL TTL ≤ 300.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with AWS SDK presigner against the R2 endpoint. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: private storage with validation`.

### Task 11: Webhook verification and idempotency scaffold

**Files:**
- Create: `supabase/migrations/0004_webhook_events.sql`, `apps/web/src/lib/webhooks.ts`
- Test: `apps/web/src/lib/webhooks.test.ts`, `supabase/tests/004_webhooks.test.sql`

**Interfaces:**
- Produces: table `webhook_events(provider text, event_id text, received_at, processed_at, payload jsonb, primary key (provider, event_id))`, service-role only; `verifyHmacSignature(opts: { payload: string; signature: string; secret: string; toleranceSec?: number; timestamp?: number }): boolean` (constant-time compare); `processOnce(provider: string, eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate">`.

- [ ] **Step 1:** Tests: valid signature true; tampered payload false; stale timestamp (> tolerance) false; `processOnce` twice with same id runs handler once and returns `"duplicate"`; authenticated (non-service) role cannot read `webhook_events`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: webhook verification scaffold`.

### Task 12: CI/CD, repo settings, migrations, backups, rollback

**Files:**
- Create: `.github/workflows/ci.yml`, `security.yml`, `migrations.yml`, `deploy.yml`, `backup.yml` (callers of `mrahamangm-droid/saas-platform-kit/.github/workflows/*@v1`), `.github/CODEOWNERS`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `docs/runbooks/{deploy,rollback,restore,incident}.md`
- Modify: `.github/workflows/ci.yml` to add jobs `rls-tests` (`supabase test db`) and `rls-coverage` (fails if `check-rls-coverage.sql` returns rows)

**Interfaces:**
- Consumes: scripts and tests from Tasks 1–11.
- Produces: required status checks list: `ci`, `rls-tests`, `rls-coverage`, `gitleaks`, `dependency-review`.

- [ ] **Step 1:** Add a deliberately failing check on a throwaway branch (table without RLS) to prove `rls-coverage` blocks merge; confirm it fails in Actions.
- [ ] **Step 2:** Write workflows with least-privilege `permissions:`; production migrations and deploy use a GitHub Environment `production` with required reviewers; staging applies on merge to `main`.
- [ ] **Step 3:** Run kit's `apply-repo-settings.sh <owner>/papple --dry-run`, review output, then apply (branch protection, required checks, environments).
- [ ] **Step 4:** Rehearse: PR → preview → staging → production approval; rollback via Vercel previous deployment; restore latest R2 dump to a scratch DB and record result in `docs/runbooks/restore.md`.
- [ ] **Step 5:** Commit `ci: pipelines, protections and runbooks`.

### Task 13: Observability and consent

**Files:**
- Create: `apps/web/src/lib/observability.ts`, `apps/web/src/components/ConsentBanner.tsx`, `apps/web/sentry.*.config.ts`
- Test: `apps/web/src/lib/observability.test.ts`

**Interfaces:**
- Produces: `scrubEvent<T extends object>(event: T): T` (removes emails, tokens, cookies, auth headers); PostHog initialised only after consent value `"granted"`.

- [ ] **Step 1:** Tests: `scrubEvent` removes `request.headers.cookie`, `authorization`, and email-looking strings; analytics init not called without consent.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire Sentry `beforeSend`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: monitoring and consent`.

### Task 14: Documentation and final acceptance run

**Files:**
- Create: `docs/architecture.md`, `docs/environments.md`, `docs/secrets.md` (names, owners, rotation; no values), `docs/adr/0001-tenancy-rls.md`, `docs/adr/0002-stripe-connect-express.md`, `docs/acceptance-subproject-1.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Run the full suite: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && supabase db reset && supabase test db && pnpm -C apps/web exec playwright test`; expect all PASS.
- [ ] **Step 2:** Walk spec §7 items 1–7; record evidence (command output or workflow run URL) per item in `docs/acceptance-subproject-1.md`. Any item without evidence is marked NOT VERIFIED and listed as a blocker.
- [ ] **Step 3:** Fix every critical/high finding and re-run Step 1.
- [ ] **Step 4:** Commit `docs: foundation docs and acceptance record`.

---

## Self-Review Notes
- Spec coverage: §6.1 repo (T1), §6.2 tenancy/RBAC (T3, T7), §6.3 config (T4), §6.4 audit/privacy (T5; export/delete tables deferred to sub-project 8 per spec), §6.5 security (T8–T11, T13), §6.6 delivery (T12), §6.7 cost (docs T14), §6.8 UX (T7), §7 acceptance (T14).
- Production-facing steps (T12 Steps 3–4, staging/prod deploy) require owner-supplied access and secrets (spec §8); until then they are NOT VERIFIED and tracked as blockers.

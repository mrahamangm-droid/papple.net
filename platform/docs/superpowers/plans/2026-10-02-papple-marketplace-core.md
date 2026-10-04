# Marketplace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Papple marketplace core: provider profiles, services, search, projects, proposals, rule-based matching, messaging, notifications and abuse reports, with isolation proven by database tests.

**Architecture:** Database-first. Every table is default-deny RLS with narrow `public_*` views for anonymous reads; writes that need cross-row rules go through `SECURITY DEFINER` RPCs. Next.js server code stays thin: zod validation, rate limits, and calls to the RPCs/views through the existing dependency-injected wiring.

**Tech Stack:** Postgres 16 (pgTAP, `pg_trgm`), Supabase (RLS, Realtime), Next.js 16 App Router, TypeScript strict, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-papple-marketplace-core-design.md` (builds on `2026-10-02-papple-foundation-design.md`).

## Global Constraints

- Repo root for all paths: `/home/claude/papple` (branch `feat/marketplace-core`, created from `feat/foundation`). Web app under `apps/web/src`.
- Migrations are numbered `0006`… in `supabase/migrations/`; tests are `supabase/tests/0NN_*.test.sql`; the local harness is `scripts/db-test.sh`; `scripts/check-rls-coverage.sql` must stay empty.
- Money = integer minor units + ISO currency code. Rates = basis points. Timestamps `timestamptz` UTC.
- Anonymous users never read base tables; only `public_provider_cards`, `public_service_cards`, `public_open_projects`.
- Helpers to reuse (already exist): `is_member(org)`, `has_org_role(org, roles[])`, `is_platform_admin()`, `shares_org(user)`; all new `SECURITY DEFINER` functions use `set search_path = public`.
- Limits, weights and toggles live in `platform_settings` (seed values are placeholders for owner confirmation): `limits.max_services`, `limits.max_portfolio_items`, `limits.proposals_per_month` (objects keyed by plan with `"default"`; `null` = unlimited), `limits.new_conversations_per_day` (int), `matching.weights`, `marketplace.premoderation` (bool), `search.page_size` (int).
- Message body ≤ 4,000 chars, plain text, always rendered escaped. Proposal currency must equal the project's currency in v1.
- No raw credentials in code, tests or docs; env names only. Never weaken the nonce CSP.
- Every task ends green: `pnpm --filter web typecheck`, `pnpm --filter web test`, `bash scripts/db-test.sh`, and `pnpm --filter web lint` (0 errors).
- Commit messages end with the two attribution lines supplied by the session reminder.

## Review Focus

1. Search text with quotes, `&`, `|`, `:`, `\`, emoji, 10,000 chars, or only whitespace → must return a normal (possibly empty) result, never a 500 (use `websearch_to_tsquery`; cap length at 200). Pinned in Task 3 and Task 8.
2. Arabic/CJK/emoji-only headlines → slug must still be non-empty and unique (fallback `p-<8 hex>`), never collide. Pinned in Task 2 and Task 8.
3. Tampered, truncated or foreign search cursor → treated as "first page", never an error or a data leak. Pinned in Task 8.
4. Proposal edge cases: price ≤ 0 or > 2,147,483,647 minor units, currency mismatch, project not open, own project, double submit race (two concurrent calls) → exactly one row. Pinned in Task 5.
5. A user belonging to several orgs (e.g. a client org and an agency): every RPC takes an explicit `p_org` and checks membership in that org, never "the first membership". Pinned in Tasks 2, 5, 6.

## File Structure

Database: `0006_taxonomy_limits.sql`, `0007_providers_services.sql`, `0008_search.sql`, `0009_projects.sql`, `0010_proposals.sql`, `0011_messaging_notifications.sql`, `0012_reports_moderation.sql`; seeds appended to `supabase/seed.sql`; tests `006`…`012`.

Web (`apps/web/src`): `lib/marketplace/{slug,validators,search,matching,notify-email}.ts` (+ `.test.ts` each); `lib/marketplace/db.ts` (thin typed wrappers over Supabase calls, DI-friendly); `lib/ratelimit.ts` (new rules); `lib/rbac.ts` (nav); `app/(public)/{explore,p/[slug],services/[slug]}/page.tsx`; `app/(app)/{profile,services,projects,projects/new,projects/[id],messages,notifications}/…`; `app/api/search/route.ts`; `app/(app)/marketplace-actions.ts` (server actions); `e2e/marketplace-anonymous.spec.ts`. Docs: `docs/acceptance-subproject-2.md`.

---

### Task 1: Branch, taxonomy and limits

**Files:** Create `supabase/migrations/0006_taxonomy_limits.sql`, `supabase/tests/006_taxonomy.test.sql`; Modify `supabase/seed.sql`.

**Interfaces:**
- Produces: tables `categories(id uuid pk, parent_id uuid null, slug text unique, name text, position int, is_active bool)`, `skills(id uuid pk, category_id uuid, slug text unique, name text, is_active bool)`; function `org_plan_key(p_org uuid) returns text` (returns `'free'` until SP3 adds subscriptions); function `org_limit(p_org uuid, p_key text) returns int` (reads `platform_settings.value`, picks the org's plan key else `"default"`, returns `null` for unlimited); extension `pg_trgm`.

- [ ] **Step 1:** `git checkout -b feat/marketplace-core`.
- [ ] **Step 2: Failing tests** in `006_taxonomy.test.sql` (plan 8): anon can `select` active categories/skills; anon cannot insert; authenticated non-admin cannot insert/update; platform admin can insert; inactive rows hidden from anon; `org_limit(org,'limits.max_services')` returns 5 for `default`; returns `null` after setting that key's `default` to `null`; unknown key returns `null`.
- [ ] **Step 3:** Run `bash scripts/db-test.sh`; expect FAIL (relations missing).
- [ ] **Step 4:** Write the migration: create extension `pg_trgm` in schema `extensions`; tables with RLS (select `using (is_active or is_platform_admin())`, writes `is_platform_admin()`); `org_plan_key`, `org_limit` (`stable`, `security definer`). Append seed: starter categories (Construction & Engineering with children Architecture, Civil/Structural, MEP, Project Management, Quantity Surveying; Technology; Design; Legal & Compliance; Finance & Accounting; Marketing) with a few skills each; the limits/weights/flag settings listed in Global Constraints with placeholder values (`limits.max_services` `{"default":5,"professional_plus":25,"business":100,"enterprise":null}`, `limits.max_portfolio_items` `{"default":6,"professional_plus":20,"business":50,"enterprise":null}`, `limits.proposals_per_month` `{"default":10,"professional_plus":60,"business":200,"enterprise":null}`, `limits.new_conversations_per_day` `20`, `matching.weights` `{"skills":50,"category":20,"budget":15,"availability":10,"language":5}`, `marketplace.premoderation` `false`, `search.page_size` `20`).
- [ ] **Step 5:** Run `bash scripts/db-test.sh`; expect PASS and `RLS coverage OK`.
- [ ] **Step 6:** Commit `feat(db): taxonomy, limits helpers and marketplace settings`.

### Task 2: Provider profiles, portfolio, services, public views

**Files:** Create `supabase/migrations/0007_providers_services.sql`, `supabase/tests/007_providers_services.test.sql`.

**Interfaces:**
- Consumes: Task 1 `org_limit`, `categories`, `skills`.
- Produces: tables `provider_profiles`, `provider_skills(profile_id, skill_id)`, `portfolio_items`, `services` (columns per spec §4); functions `make_slug(p_text text) returns text` (lowercase ascii-hyphen; empty result → `'p-' || 8 hex chars`), `upsert_provider_profile(p_org uuid, p_headline text, p_summary text, p_country text, p_languages text[], p_hourly_min int, p_hourly_max int, p_currency text, p_availability text, p_visibility text, p_skill_ids uuid[]) returns uuid` (caller must be owner/admin of `p_org` whose type is `individual` or `agency`; creates slug on first insert only, appends `-2`, `-3` on collision; replaces skills), `upsert_service(p_org uuid, p_id uuid, …) returns uuid` (enforces `org_limit(...,'limits.max_services')` on publish; slug unique), views `public_provider_cards`, `public_service_cards` (security definer-owner views granting `select` to anon/authenticated; whitelisted columns only; rows only when `visibility='public' and status='active'` / service `published` and owner profile public+active).

- [ ] **Step 1: Failing tests** (plan ~24): anon reads a public published card but not a `private` one; anon cannot `select` from `provider_profiles`/`services` base tables (permission denied); views expose no `org_id` of members, no `created_by`; member with role `viewer` cannot upsert, `member` cannot, `admin` can; owner of org A cannot touch org B's profile; same user in two orgs: upsert with `p_org` = client org (type `client_company`) is refused; `make_slug('مهندس')` starts with `p-`; two profiles with the same headline get distinct slugs; slug unchanged on later headline edit; service limit: 6th published service refused with errcode `54000` when default is 5, draft services not counted; portfolio limit enforced by trigger.
- [ ] **Step 2:** Run harness; expect FAIL.
- [ ] **Step 3:** Implement migration: tables + RLS (members of org read/write own rows per role; platform admin reads all), the RPCs above, a trigger on `portfolio_items` enforcing `limits.max_portfolio_items`, the two views (with `security_barrier`), `grant select` on views only.
- [ ] **Step 4:** Run harness; PASS and RLS coverage OK.
- [ ] **Step 5:** Commit `feat(db): provider profiles, services and public views`.

### Task 3: Search functions

**Files:** Create `supabase/migrations/0008_search.sql`, `supabase/tests/008_search.test.sql`.

**Interfaces:**
- Consumes: Task 2 views and tables.
- Produces: generated `search_vector tsvector` + GIN index on `provider_profiles` (headline, summary, skill names via trigger-maintained text column `skills_text`) and `services` (title, description); trigram GIN index on `headline`/`title`; functions `search_provider_cards(p_q text, p_category uuid, p_skill_ids uuid[], p_country text, p_rate_max int, p_availability text, p_after_rank real, p_after_id uuid, p_limit int) returns table(card jsonb, rank real, id uuid)` and `search_service_cards(p_q text, p_category uuid, p_price_max int, p_after_rank real, p_after_id uuid, p_limit int)`; both `security definer`, read only the public views' rows, clamp `p_limit` to 1..50, truncate `p_q` to 200 chars, use `websearch_to_tsquery('simple', …)` plus `similarity()` boost, order by `(rank desc, id)`.

- [ ] **Step 1: Failing tests:** matching headline returns the card; private/hidden profiles never returned; filters (category, skill, country, rate, availability) narrow results; keyset pagination: page 2 contains no id from page 1 and union equals the full ordered set; `p_q` values `"'; drop table x; --"`, `'&|:*'`, 300×`'a'`, `''`, `'   '`, emoji all return without error; `p_limit => 1000` returns ≤ 50 rows; typo `'architct'` still finds "Architect" via trigram.
- [ ] **Step 2:** Run harness; expect FAIL.
- [ ] **Step 3:** Implement migration. Empty/whitespace query → browse mode ordered by `updated_at desc, id`.
- [ ] **Step 4:** Run harness; PASS. **Step 5:** Commit `feat(db): provider and service search`.

### Task 4: Projects and saved items

**Files:** Create `supabase/migrations/0009_projects.sql`, `supabase/tests/009_projects.test.sql`.

**Interfaces:**
- Consumes: Task 1 taxonomy, `has_org_role`.
- Produces: tables `projects`, `project_skills`, `saved_items(user_id, kind text check in ('profile','service','project'), target_id uuid)`; function `upsert_project(p_org uuid, p_id uuid, p_title text, p_description text, p_category uuid, p_budget_min int, p_budget_max int, p_currency text, p_deadline date, p_visibility text, p_skill_ids uuid[]) returns uuid` (org type must be `client_company`, `enterprise`, or `agency`; role owner/admin/member; budget_min ≤ budget_max; deadline not in the past; premoderation setting sets status `pending_review` instead of `open` when true), `set_project_status(p_org uuid, p_id uuid, p_status text)` (draft→open→closed, any→cancelled); view `public_open_projects` (only `visibility='public'`, open; title, truncated 280-char summary, budget band, category, skills; no org id).

- [ ] **Step 1: Failing tests:** draft visible only to owning org members; open project readable by an authenticated provider via base-table policy but contact-free; anon sees only `public_open_projects`; viewer role cannot create; deadline in the past refused; `budget_min > budget_max` refused; premoderation=true yields `pending_review`; saved_items readable only by owner; user cannot save for another user; cross-org update refused.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS). **Step 5:** Commit `feat(db): projects, saved items and public project view`.

### Task 5: Proposals

**Files:** Create `supabase/migrations/0010_proposals.sql`, `supabase/tests/010_proposals.test.sql`.

**Interfaces:**
- Consumes: Tasks 2, 4, `org_limit`.
- Produces: table `proposals` with `unique (project_id, org_id)`; RPCs `submit_proposal(p_org uuid, p_project uuid, p_cover_letter text, p_price int, p_currency text, p_delivery_days int) returns uuid`, `withdraw_proposal(p_org uuid, p_id uuid)`, `set_proposal_status(p_id uuid, p_status text)` (client org owner/admin/member only; only `shortlisted`/`declined`). Errors use errcodes: `42501` not allowed, `22023` invalid input, `54000` limit, `23505` duplicate.

- [ ] **Step 1: Failing tests:** happy path; price 0, −1, 2147483648 refused; cover letter empty or > 5,000 chars refused; currency ≠ project currency refused; non-open project refused; own project (provider org = client org) refused; second submit refused; withdraw then resubmit allowed once, a second resubmit refused; monthly limit (set `default` to 2) refused on 3rd within month and unlimited when `null`; visibility: proposing org and project client org see it, a third org and anon do not; client can shortlist/decline, provider cannot set those; provider can withdraw only its own; user in two orgs must pass the right `p_org`; concurrency: two simultaneous `submit_proposal` (separate connections via `dblink` or two `psql` backgrounded in the test script step) yield one row — if the harness cannot run concurrent sessions, assert the unique index exists and a duplicate insert fails with `23505`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(db): proposals with limits and RPCs`.

### Task 6: Messaging and notifications

**Files:** Create `supabase/migrations/0011_messaging_notifications.sql`, `supabase/tests/011_messaging.test.sql`.

**Interfaces:**
- Produces: tables `conversations(id, kind check in ('project','service','profile'), project_id null, service_id null, profile_id null, created_by)`, `conversation_participants(conversation_id, org_id, user_id null)`, `messages(id, conversation_id, sender_user_id, sender_org_id, body, created_at)`, `notifications(id, user_id, type, payload jsonb, read_at, created_at)`; RPCs `start_conversation(p_from_org uuid, p_to_org uuid, p_kind text, p_ref uuid, p_first_message text) returns uuid` (not self; enforces `limits.new_conversations_per_day`; reuses an existing open thread for the same pair+ref), `send_message(p_conversation uuid, p_org uuid, p_body text) returns uuid` (trim; empty or > 4000 refused; sender org must be a participant and caller a member), `mark_notification_read(p_id uuid)`; internal `notify(p_user uuid, p_type text, p_payload jsonb)` (not granted to clients); triggers create notifications for new proposal, proposal status change, new message (to the other side's org members), project closed.

- [ ] **Step 1: Failing tests:** only participant-org members read a thread and its messages; stranger and anon cannot; direct insert into `messages`/`notifications` by clients refused; self-message refused; whitespace-only and 4,001-char bodies refused; 4,000 accepted; daily conversation limit refused after N; repeat start reuses thread; user sees only their notifications and can mark only their own read; a proposal submission notifies client org members and not the proposer; payload contains ids only, no message text beyond a 80-char preview.
- [ ] **Step 2–4:** FAIL → implement (add `messages` and `notifications` to the `supabase_realtime` publication guarded by `if exists publication`) → PASS. **Step 5:** Commit `feat(db): messaging and notifications`.

### Task 7: Reports and moderation

**Files:** Create `supabase/migrations/0012_reports_moderation.sql`, `supabase/tests/012_reports.test.sql`.

**Interfaces:**
- Produces: table `content_reports(id, reporter_id, target_kind check in ('profile','service','project','message'), target_id, reason text ≤ 1,000, status default 'open')`; RPC `report_content(p_kind text, p_id uuid, p_reason text) returns uuid` (one open report per reporter+target); RPC `admin_set_visibility(p_kind text, p_id uuid, p_hidden boolean)` (platform admin or support; writes an `audit_log` row through the existing append-only table with actor, target and reason; sets `status='hidden_by_admin'` on profiles/services/projects).

- [ ] **Step 1: Failing tests:** any authenticated user can report; anon cannot; reporter cannot read others' reports, admin/support can; duplicate open report refused; non-admin calling `admin_set_visibility` refused; hiding a profile removes it from `public_provider_cards` and from search; unhiding restores; each action writes an audit row.
- [ ] **Step 2–4:** FAIL → implement → PASS (plus full harness). **Step 5:** Commit `feat(db): reports and admin hide`.

### Task 8: Slug, validators, search query builder

**Files:** Create `apps/web/src/lib/marketplace/{slug,validators,search}.ts` and matching `*.test.ts`.

**Interfaces:**
- Produces: `slugify(text: string, randomHex?: () => string): string`; zod schemas `profileInput`, `serviceInput`, `projectInput`, `proposalInput`, `messageInput`, `reportInput`, `searchParams` (each exporting its inferred type); `encodeCursor(rank: number, id: string): string`, `decodeCursor(s: string | undefined): { rank: number; id: string } | null` (returns `null` for anything malformed, wrong length, non-UUID id, non-finite rank); `createSearch(deps: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>; pageSize: () => Promise<number> })` returning `{ providers(params): Promise<{ items: ProviderCard[]; nextCursor: string | null }>; services(params): Promise<…> }`.

- [ ] **Step 1: Failing tests:** `slugify("Senior Architect — Dubai!")` = `"senior-architect-dubai"`; `slugify("مهندس")` matches `/^p-[0-9a-f]{8}$/`; `slugify("😀")` same; 120-char input truncated to ≤ 60; `decodeCursor` returns `null` for `undefined`, `"x"`, base64 of `"1|not-a-uuid"`, `"NaN|<uuid>"`; round-trips a valid pair; `searchParams.parse` trims, caps `q` at 200, rejects `rate_max` < 0 and non-numeric, coerces comma-separated skills to ≤ 10 UUIDs; `proposalInput` rejects price ≤ 0, > 2147483647, empty cover letter; `messageInput` rejects whitespace-only and > 4000; `createSearch.providers` calls `search_provider_cards` with the decoded cursor (or nulls when invalid), `p_limit = pageSize + 1`, and sets `nextCursor` only when an extra row exists; an RPC error surfaces as a thrown `SearchError` with a generic message.
- [ ] **Step 2:** `pnpm --filter web test -- marketplace` expect FAIL. **Step 3:** Implement. **Step 4:** PASS + typecheck. **Step 5:** Commit `feat(web): marketplace validators, slug and search builder`.

### Task 9: Matching

**Files:** Create `apps/web/src/lib/marketplace/matching.ts`, `matching.test.ts`.

**Interfaces:**
- Produces: `type MatchWeights = { skills: number; category: number; budget: number; availability: number; language: number }`; `scoreMatch(project: MatchProject, provider: MatchProvider, weights: MatchWeights): { score: number; reasons: string[] }`; `rankProviders(project, providers, weights, limit): { provider: MatchProvider; reasons: string[] }[]` (score used for ordering only and **not returned**); `recommendProjects(provider, projects, weights, limit)` (same, reversed). Reasons are fixed human strings: `"Matches X of Y skills"`, `"Same category"`, `"Within budget"`, `"Available now"`, `"Speaks <lang>"`.

- [ ] **Step 1: Failing tests:** full skill overlap outranks partial; category match adds weight; budget fit uses provider hourly band vs project band (overlap = within); `unavailable` providers excluded from `rankProviders`; weights of 0 remove a factor; weights not summing to 100 still order correctly; ties broken by provider id for determinism; empty skill lists give no "Matches" reason and no NaN; the returned objects contain no numeric `score` field.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(web): rule-based matching with reasons`.

### Task 10: Rate limits, wiring, RBAC nav

**Files:** Modify `lib/ratelimit.ts`, `lib/ratelimit.test.ts`, `lib/rbac.ts`, `lib/rbac.test.ts`, `lib/server.ts`; Create `lib/marketplace/db.ts`.

**Interfaces:**
- Produces: new `RULES` entries `search: {limit: 60, windowSec: 60}`, `proposal: {10, 60}`, `message: {30, 60}`, `report: {5, 60}`, `conversation: {10, 60}`; `navFor(ctx)` adds `{href:"/explore",label:"Explore"}`, `{href:"/projects",label:"Projects"}`, `{href:"/messages",label:"Messages"}`, `{href:"/notifications",label:"Notifications"}` for any signed-in user, and `{href:"/profile",label:"My profile"}` plus `{href:"/services",label:"My services"}` only when the user has a membership (never based on persona alone); `lib/server.ts` exports `searchService` (lazy, built with `createSearch` over the user-context Supabase client with anon fallback) and `marketplaceDb` (typed wrappers `upsertProfile`, `upsertService`, `upsertProject`, `submitProposal`, `setProposalStatus`, `startConversation`, `sendMessage`, `report`).

- [ ] **Step 1: Failing tests:** each rule key exists with exact values; `navFor` for a user with no memberships omits profile/services; with a membership includes them; admin link rules unchanged.
- [ ] **Step 2–4:** FAIL → implement (wrappers translate Postgres errcodes `42501`→`ForbiddenError`, `22023`→`ValidationError`, `54000`→`LimitError`, `23505`→`DuplicateError`, anything else → generic) → PASS; confirm `next build` still passes without secrets. **Step 5:** Commit `feat(web): marketplace wiring, rate limits and navigation`.

### Task 11: API route and server actions

**Files:** Create `app/api/search/route.ts`, `app/(app)/marketplace-actions.ts`, tests beside them.

**Interfaces:**
- Consumes: Tasks 8, 10.
- Produces: `GET /api/search?kind=providers|services&…` (anon allowed; per-IP `search` rule; 429 with `Retry-After`; 400 on invalid params; JSON `{items,nextCursor}`; never returns org ids); server actions `saveProfile`, `saveService`, `saveProject`, `submitProposalAction`, `decideProposal`, `startThread`, `postMessage`, `reportContent`, each: zod parse → `authorize` via `getAuthContext` → per-user rate rule → wrapper call → `revalidatePath`; errors map to typed result `{ ok: false, code: "forbidden"|"invalid"|"limit"|"duplicate"|"rate"|"error" }`, never raw messages.

- [ ] **Step 1: Failing tests (Vitest, mocked deps):** search route returns 400 for `kind=x`, 429 on the 61st call, 200 shape without `org_id`; each action returns `code:"invalid"` on bad input before touching the DB, `"forbidden"` for unauthenticated, `"rate"` when the limiter blocks, and passes the explicit `orgId` from the form (not a default membership).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(web): search API and marketplace server actions`.

### Task 12: Public pages

**Files:** Create `app/(public)/explore/page.tsx`, `app/(public)/p/[slug]/page.tsx`, `app/(public)/services/[slug]/page.tsx`, `components/marketplace/{ProviderCard,ServiceCard,SearchForm,JsonLd}.tsx`; Modify `proxy.ts` route gate to leave `/explore`, `/p/*`, `/services/*` public.

**Interfaces:** pages read only `public_*` views via the anon-capable client; unknown or private slug → `notFound()`; `generateMetadata` sets title/description/canonical and Open Graph; `JsonLd` renders `Person`/`Organization`/`Service` with the CSP nonce and escapes `<`.

- [ ] **Step 1: Failing e2e** `e2e/marketplace-anonymous.spec.ts`: `/explore` returns 200 without redirect, has one `<h1>`, labelled search input, no horizontal scroll at 390px; `/p/does-not-exist` returns 404; response headers still carry CSP with nonce; JSON-LD script has the nonce; `/projects` and `/messages` still redirect (307) to `/signin?next=`.
- [ ] **Step 2–4:** Run Playwright (expect FAIL) → implement → PASS on desktop and Pixel 7. **Step 5:** Commit `feat(web): public explore, profile and service pages`.

### Task 13: Signed-in pages

**Files:** Create under `app/(app)/`: `profile/page.tsx`, `services/page.tsx`, `projects/page.tsx`, `projects/new/page.tsx`, `projects/[id]/page.tsx`, `messages/page.tsx`, `messages/[id]/page.tsx`, `notifications/page.tsx`; components `components/marketplace/{ProfileForm,ServiceForm,ProjectForm,ProposalForm,ProposalList,ThreadView,ReportButton,OrgPicker}.tsx`.

**Interfaces:** `OrgPicker` is required wherever a user has more than one eligible org and posts the chosen `orgId`; `ProjectDetail` shows ranked providers with reasons to the client org only; providers see recommended projects with reasons; all message text rendered as escaped text; Realtime subscription in `ThreadView` is optional-enhancement (page works without it).

- [ ] **Step 1: Failing component/unit tests** for `OrgPicker` (single org auto-selected, multiple shows select), `ProposalList` (client sees all, provider sees own only — data comes pre-filtered, test that no foreign rows render), and a message containing `<script>alert(1)</script>` renders as text.
- [ ] **Step 2–4:** FAIL → implement → PASS; run typecheck, lint, build. **Step 5:** Commit `feat(web): marketplace signed-in pages`.

### Task 14: Email notifications (flagged)

**Files:** Create `lib/marketplace/notify-email.ts`, `notify-email.test.ts`; Modify `lib/server.ts`, `supabase/seed.sql` (flag `marketplace.email_notifications` default false).

**Interfaces:** `createEmailNotifier(deps: { loadUnread: (olderThanMs: number) => Promise<{ id: string; userEmail: string; type: string; link: string }[]>; send: (m: { to: string; subject: string; text: string }) => Promise<void>; markEmailed: (ids: string[]) => Promise<void>; isEnabled: () => Promise<boolean>; delayMs: number })` returning `{ run(): Promise<{ sent: number }> }`; bodies contain a neutral sentence and link only, never message text or amounts. Add column `notifications.emailed_at timestamptz` in a new migration `0013_notification_email.sql` with a test that clients cannot set it.

- [ ] **Step 1: Failing tests:** disabled flag sends nothing; sends once per notification then marks emailed; failure for one recipient does not block others; body contains no proposal price or message text.
- [ ] **Step 2–4:** FAIL → implement → PASS (+ harness). **Step 5:** Commit `feat: flagged email notifications`.

### Task 15: Verification, mutation check, acceptance record

**Files:** Create `docs/acceptance-subproject-2.md`; Modify `README.md`, `docs/architecture.md`, `docs/superpowers/specs/…-marketplace-core-design.md` (status line only).

- [ ] **Step 1:** Run the full suite: typecheck, unit tests, `bash scripts/db-test.sh`, Playwright (desktop + Pixel 7), lint, `next build` with no secrets, `pnpm audit --prod`, secret scan; record exact counts.
- [ ] **Step 2: Mutation check:** temporarily change one proposals policy to `using (true)` and one public view to drop its `visibility` filter; confirm the harness fails; revert; confirm green. Record in the acceptance doc.
- [ ] **Step 3:** Write the acceptance table (VERIFIED / PARTIAL / NOT VERIFIED). Must list as NOT VERIFIED: real Supabase run (Realtime RLS, grants, `pg_trgm`), authenticated e2e per role, email delivery through Resend, anything deployed.
- [ ] **Step 4:** Self-review the whole branch diff for secrets, console logging of user text, and any query that selects `*` from a base table in a public path; fix findings test-first.
- [ ] **Step 5:** Commit `docs: marketplace core acceptance record`; then push per owner direction (papple.net `platform/` upload or token push).

## Self-Review Notes

Spec coverage: taxonomy/limits (1), profiles/services/portfolio/public views (2), search (3, 8), projects/saved (4), proposals (5), messaging/notifications (6, 14), reports/moderation (7), matching (9), rate limits/nav (10), actions/API (11), public UI + JSON-LD (12), signed-in UI (13), testing and honesty (15). Type names `ProviderCard`, `MatchProject`, `MatchProvider`, `SearchError`, `LimitError`, `DuplicateError` are defined in Tasks 8–10 and reused later. Plan proportion: signatures, assertions and values only; bodies left to the implementer.

# PAPple — Sub-project 2: Marketplace Core — Design

Date: 2026-10-02 · Status: APPROVED and implemented on `feat/marketplace-core` (see `docs/acceptance-subproject-2.md`) · Builds on: `2026-10-02-papple-foundation-design.md`

## 1. Purpose and success criteria

Marketplace core lets Professionals and Agencies be discovered, Clients post work, and both sides talk, without money moving yet.

Success = this journey works end to end, with isolation proven by database tests:

Professional publishes profile + service → Client finds them via search (or posts a project) → Professional submits a proposal → Client shortlists/declines → both message → each side gets notifications.

Not in scope here (later sub-projects): contracts, milestones, payments and commission (SP3), reviews and disputes (SP3), admin console screens (SP4, but the tables and RPCs it needs are created here), CRM/tasks (SP5), AI assistance (SP6), PGAN verification badges and talent pools (SP7), legal/SEO hardening (SP8).

## 2. Owner decisions (from this brainstorm)

1. **Taxonomy:** all professions at launch, **Admin-managed** category tree and skills list, seeded with a small starter set (construction & engineering first, matching papple.net).
2. **Visibility:** profiles and services are **public and indexable by default**; the owner can switch to private. Contact details are never shown publicly (profiles store no email or phone at all).

## 3. Approaches considered

**Search.** (A) Postgres full-text + `pg_trgm` inside Supabase. (B) External search service (Typesense/Algolia/Meilisearch). (C) Simple `ILIKE`. **Choice: A.** It costs nothing extra, stays inside RLS and tenancy, and handles launch scale. The query builder sits behind one interface so B can replace it later without touching pages.

**Matching.** (A) Rule-based weighted score computed on demand. (B) Embedding/vector matching. **Choice: A** for now (explainable, testable, free); B belongs to the AI sub-project. Weights live in `platform_settings`, so Admin can tune them.

**Public data exposure.** (A) Anonymous RLS directly on base tables. (B) Anonymous access only through narrow views. **Choice: B.** Base tables stay default-deny for `anon`; public pages read `public_*` views that expose only safe columns.

## 4. Data model (migration `0006_marketplace_core.sql` and following)

All tables: RLS on, default deny, `org_id` on business rows, money as integer minor units + ISO currency code, timestamps UTC. Every table is covered by the existing `check-rls-coverage` script.

| Table | Purpose | Key rules |
|---|---|---|
| `categories` | Admin-managed tree (`parent_id`, `slug`, `name`, `position`, `is_active`) | Readable by everyone; write: platform admin only. |
| `skills` | Admin-managed (`slug`, `name`, `category_id`, `is_active`) | Same as categories. |
| `provider_profiles` | One per provider org (`org_id` unique): `slug` (unique), `headline`, `summary`, `country`, `languages`, `hourly_min/max`, `currency`, `availability` (`available`/`limited`/`unavailable`), `visibility` (`public`/`private`), `status` (`active`/`hidden_by_admin`), generated `search_vector` | Org members with role owner/admin write; public read only via view when `visibility='public'` and `status='active'`. |
| `provider_skills` | profile ↔ skill | Same ownership as profile. |
| `portfolio_items` | title, description, optional R2 file key (via existing signed-URL pipeline), optional link | Max items from `limits.max_portfolio_items`. |
| `services` | `org_id`, `category_id`, `slug`, `title`, `description`, `pricing_model` (`fixed`/`hourly`/`quote`), `price_min` (minor units), `currency`, `delivery_days`, `status` (`draft`/`published`/`archived`), generated `search_vector` | Public via view only when published and owner profile public/active. Max count from `limits.max_services` per plan. |
| `projects` | Client `org_id`, `created_by`, `title`, `description`, `category_id`, `budget_min/max`, `currency`, `deadline`, `status` (`draft`/`open`/`closed`/`cancelled`), `visibility` (`public`/`members_only`) | Draft visible only to owning org. Open projects visible to signed-in providers (and public if `visibility='public'`, title/summary/budget band only). |
| `project_skills` | project ↔ skill | Same as project. |
| `proposals` | `project_id`, provider `org_id`, `cover_letter`, `price` (minor), `currency`, `delivery_days`, `status` (`submitted`/`withdrawn`/`shortlisted`/`declined`) | Unique `(project_id, org_id)`. Visible only to the project's client org and the proposing org. Client can set shortlisted/declined; provider can withdraw. Created only through RPC `submit_proposal` (enforces project open, monthly limit, not own project). |
| `conversations`, `conversation_participants`, `messages` | Thread tied to a project/proposal, a service, or a direct profile inquiry; `messages.body` plain text ≤ 4,000 chars | Visible only to participant orgs' members. Created through RPC `start_conversation` (cannot message yourself; max new conversations per day per user from settings). |
| `notifications` | `user_id`, `type`, `payload` (jsonb, no secrets), `read_at` | A user sees and updates only their own. Rows written only by trusted RPC/trigger code. |
| `content_reports` | Reporter, target type/id, reason, status | Insert by any signed-in user; read/update by platform admin/support only. |
| `saved_items` | Client bookmarks of profiles/services; provider bookmarks of projects | Own rows only. |

**Public views** (`anon` + `authenticated` select): `public_provider_cards`, `public_service_cards`, `public_open_projects`. Only whitelisted columns; no `created_by`, no private fields, no org membership data.

**Settings and limits (data, not code):** new keys in `platform_settings` — `limits.max_services`, `limits.max_portfolio_items`, `limits.proposals_per_month`, `limits.new_conversations_per_day`, `matching.weights`, `marketplace.premoderation` (default false), `search.page_size`. Per-plan values come from the existing `plans`/settings mechanism so Admin edits them with no deploy. Launch values are seed data only and marked as placeholders for owner confirmation.

## 5. Behaviour

**Profiles.** A provider (individual or agency org) creates exactly one profile. Slug is generated from the headline, unique, and immutable after publish (prevents link rot; Admin can override). Public pages render server-side with JSON-LD `Person`/`Organization`.

**Search.** `GET /explore` and `GET /api/search` take free text, category, skills, country, rate band, availability, entity type (profiles/services), and a cursor. Ranking = full-text rank + trigram similarity on name/headline; stable keyset pagination; page size from settings. Anonymous search is rate-limited by IP (existing limiter, new rule `search`). Responses use the public views only.

**Matching (rule-based, explainable).** For a project: rank providers by weighted skill overlap, category match, budget fit against hourly/fixed band, availability, and language. Weights come from `matching.weights`. The UI shows **reasons** ("Matches 4 of 5 skills", "Within budget") and never a raw numeric score. The same function in reverse recommends open projects to a provider. It reads only data the viewer may already see.

**Proposals.** Submit via RPC (atomic checks). A provider can have one active proposal per project; withdrawing allows resubmitting once. Client actions are shortlisted/declined only; "hire" belongs to SP3 and will create the contract.

**Messaging.** Polling-free updates via Supabase Realtime subscriptions scoped by RLS to participants; unread counts from `notifications`. v1 stores plain text only (attachments reuse the existing signed-upload route in a later increment). Contact-info filtering is **deferred** (flag-and-review is cheaper than blocking and is an SP4 admin concern); this is logged as a known gap.

**Notifications.** In-app for: new proposal, proposal status change, new message, project closed. Email through Resend for new proposal and new message only when the user has not read it within a delay, controlled by a feature flag and per-user preference. No email contents beyond a link and a neutral summary.

**Moderation.** Post-moderation by default: content publishes immediately; any user can report; Admin/support can hide a profile/service/project (`hidden_by_admin`), writing an audit log row via the existing admin-action wrapper. `marketplace.premoderation=true` switches new profiles/projects to a review queue without code changes.

## 6. Security and privacy

- Every new table has RLS tests for: anonymous, signed-in stranger, same-org member by role, other-org member, platform admin.
- Public surface is views only; contact data is never stored in profile tables.
- All writes validated with zod; RPCs are `SECURITY DEFINER` with fixed `search_path` and re-check membership using the existing helpers (`has_org_role`, `is_member`).
- Rate limits: search (anon), proposal submit, start conversation, send message, report.
- Admin actions use the existing audited wrapper and admin MFA (aal2) enforcement.
- Deleting or suspending a user hides their public content and keeps audit trails; hard-delete flows remain deferred with the account-deletion work already logged.

## 7. UI surface

Public: `/explore`, `/p/[slug]`, `/services/[slug]`, public project teasers. Signed-in: provider profile editor, services manager, `/projects` (browse + recommended), `/projects/new`, `/projects/[id]` (client sees proposals, provider sees own), `/messages`, `/notifications`, saved items. Uses the existing UI kit and AppShell; role-aware navigation from `navFor`.

Performance note carried from Foundation: strict nonce CSP forces dynamic rendering. Public SEO pages need a CSP/caching revisit; this sub-project records the measured cost and adds cache-friendly headers where possible but does not weaken the CSP.

## 8. Testing and verification

- **DB (pgTAP, local Postgres 16 harness):** isolation matrix above; proposal uniqueness and limits; conversation access; view column whitelist; trigger/RPC edge cases; mutation test (deliberately broken policy turns tests red).
- **Unit (Vitest):** search query builder, matching scorer and reasons, slug generation, validators, limit logic.
- **E2E (Playwright, real Chromium, desktop + phone):** anonymous explore and public profile, redirect of gated routes, accessibility checks, no horizontal scroll. Authenticated flows need real Supabase and are recorded as NOT VERIFIED until accounts exist.
- Acceptance record `docs/acceptance-subproject-2.md` with the same honest VERIFIED / NOT VERIFIED table as SP1.

## 9. Known gaps and risks (stated up front)

1. Real Supabase behaviour (Realtime RLS, default grants, extensions `pg_trgm`) is unverified until the owner's projects exist.
2. Search quality at larger scale may need an external engine (interface prepared).
3. Contact-info leakage in messages is not filtered in v1.
4. Seed limits and matching weights are placeholders pending owner confirmation.
5. The existing papple.net repo holds this work under `platform/`; moving to a standalone repo remains the owner's call.

## 10. Build order inside this sub-project

1. Taxonomy + settings seeds. 2. Provider profiles/portfolio/services + public views + tests. 3. Search. 4. Projects + saved items. 5. Proposals + limits. 6. Matching. 7. Conversations/messages/notifications. 8. Reports + moderation hooks. 9. UI pages. 10. E2E, acceptance record.

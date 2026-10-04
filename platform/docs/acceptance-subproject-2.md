# Sub-project 2 (Marketplace core) — acceptance record

Run date: 2026-10-02 · Branch: `feat/marketplace-core` (local; built on `feat/foundation`). Not pushed or merged — publishing to GitHub needs the owner's go-ahead.
Legend: **VERIFIED** = observed passing in this session · **PARTIAL** · **NOT VERIFIED** = needs the owner's accounts, a live service or real data. Nothing marked NOT VERIFIED may be assumed to work.

## Evidence run (fresh, same session)
| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint src` | 0 errors, 1 warning (pre-existing MFA full-page navigation) |
| Vitest | 33 files, 266 tests passed |
| `scripts/db-test.sh` (Postgres 16 + pgTAP + auth shim) | 235 assertions passed; RLS coverage OK (every new table has RLS) |
| `scripts/db-race-test.sh` (8 parallel sessions behind an advisory-lock barrier) | 5/5 passed twice; before the fixes 4 of 5 failed (limits and de-duplication were exceeded) |
| `next build` (Next 16) without secrets | success |
| Playwright (real Chromium, desktop + Pixel 7, `next start`) | 48 passed |
| `pnpm audit --prod` | no known vulnerabilities |
| Secret-pattern scan of tracked files | clean (one fixture string `whsec_test` in a unit test) |

## Mutation check (the harness must fail when isolation breaks)
1. `proposals_select` policy changed to `using (true)` → harness FAILED ("third org sees no proposals"). Reverted → green.
2. `public_provider_cards` view stripped of its `visibility = 'public'` filter → harness FAILED (private profile visible to anon; search returned a private profile). Reverted → 218 passed.

## Journey (spec §1)
Provider publishes profile + service → client finds them by search or posts a project → provider submits a proposal → client shortlists or declines → both message → both receive notifications.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Admin-managed taxonomy, starter seed | **VERIFIED (local)** | pgTAP: anon reads active only, only platform admins write. Seed values are placeholders for owner confirmation. |
| 2 | Profiles, services, portfolio limits, public views | **VERIFIED (local)** | pgTAP: views expose no org ids or private fields; private/hidden/draft excluded; per-plan limits enforced (SQLSTATE 54000). |
| 3 | Search (full-text + trigram, keyset paging, filters) | **VERIFIED (local)** | pgTAP on ranking, filters, ALL-of skills, stable paging; Vitest on query builder and cursor tampering. **NOT VERIFIED:** relevance quality on real data; `pg_trgm` on real Supabase. |
| 4 | Projects, saved items, moderation toggle | **VERIFIED (local)** | pgTAP: draft visible only to owner org; `marketplace.premoderation` routes to review and `admin_review_project` (staff + aal2, audited) approves or rejects; `created_by` not readable. Profiles are not premoderated and an owner can edit an approved project (see gaps). |
| 5 | Proposals (one per project, one resubmission, monthly limit, no self-bid) | **VERIFIED (local)** | pgTAP isolation matrix: client org + proposing org only; strangers and third orgs denied; a person in both the client org and an agency cannot bid on that client's project. Race harness: the monthly limit holds under parallel submits. |
| 6 | Messaging and notifications | **VERIFIED (local) / NOT VERIFIED (Realtime)** | pgTAP: participants only, cannot message yourself, daily conversation cap, notifications private to the user. The page works by refresh; Realtime subscription is not built (spec marks it an enhancement). |
| 7 | Reports and moderation | **VERIFIED (local)** | pgTAP: any signed-in user can report; only staff with aal2 can hide/unhide; each action writes `audit_log`. |
| 8 | Rule-based explainable matching | **VERIFIED (unit) / PARTIAL (data path)** | Vitest: reasons only, no numeric score exposed, weights from `matching.weights`, deterministic tie-break. pgTAP: `provider_match_candidates` gives signed-in users public providers with skill and category ids, never their own organizations, no org ids; `proposal_providers` labels proposers for the client and proposer only. **NOT VERIFIED:** the pages that consume them against real rows. |
| 9 | Search API, server actions, rate limits | **VERIFIED (unit + e2e)** | 400 on bad params, 429 + `Retry-After` on the 61st call, generic errors, explicit `orgId` on every write, validation before any DB call. `/explore` and `/api/search` share one throttled path (`createGuardedSearch`). The search RPCs remain directly callable through PostgREST without the web throttle. |
| 10 | Public pages: `/explore`, `/p/[slug]`, `/services/[slug]` | **PARTIAL** | Browser-verified with no database: 200, one `h1`, labelled search, no horizontal scroll at phone width, strict nonce CSP, 404 for malformed slugs, signed-in areas still redirect (307), `/services/<slug>` is not gated while `/services` is. **NOT VERIFIED:** rendering with real rows, JSON-LD nonce on a real profile (escaping is unit-tested). |
| 11 | Signed-in pages (profile, services, projects, proposals, messages, notifications) | **PARTIAL** | Pure components unit-tested (org picker, proposal list renders what it is given, message `<script>` renders as text; isolation itself is proven by the pgTAP matrix, not by these tests). Pages typecheck, lint and build. **NOT VERIFIED:** any authenticated flow end to end — needs a live Supabase Auth. |
| 12 | Flagged email nudges | **PARTIAL** | Vitest: flag off sends nothing; one email per notification; one failure does not block others; permanently undeliverable recipients are retired so they cannot jam the queue; bodies hold a link only. pgTAP: users cannot set `emailed_at`. **NOT VERIFIED:** delivery through Resend; scheduler not configured. |

## Independent review (fresh reviewer, most capable model) and fixes
The reviewer ran the harness and probe SQL and found eight Important issues. Each was fixed with a test that failed first; Minor findings are listed under Known gaps.
1. Self-bid through a second organization the same person controls → blocked in `submit_proposal` (pgTAP RED→GREEN).
2. Monthly proposal, service-publish and portfolio limits exceeded under parallel calls → per-org advisory locks (race harness RED→GREEN).
3. Conversation de-duplication and the daily cap raced → per-user and per-thread advisory locks (race harness RED→GREEN).
4. Suggested professionals and proposer names could never load (member-only RLS) → `provider_match_candidates` and `proposal_providers` views with pgTAP isolation tests.
5. Premoderated projects were stuck in `pending_review` → `admin_review_project`.
6. `/explore` ran unthrottled anonymous search → shared throttled path (unit RED→GREEN).
7. Money assumed two decimals (JPY 100x, KWD 10x wrong) → currency-exponent helpers used by forms, display and JSON-LD (unit RED→GREEN).
8. A pile of undeliverable addresses could occupy the email batch forever → permanent failures retired, 24-hour window, oldest first (unit RED→GREEN).

## Author self-review fixes (test-first)
1. `forEach(revalidate)` would pass the array index as `revalidatePath`'s second argument → explicit loop; test asserts a single argument.
2. Three actions the UI needed but the plan omitted (change project status, withdraw proposal, mark notification read) were added with RED→GREEN tests.
3. Proxy gate extracted to `lib/route-gate.ts` with tests, because `/services` (manager) and `/services/<slug>` (public) share a prefix.

## Known gaps (stated up front)
0. Review minors not fixed: a declined provider can withdraw and resubmit once; clients can still shortlist or decline on closed projects; "unhide" on content that is not hidden unpublishes it; existing conversations continue after their subject is hidden; a user in several provider organizations gets one chosen silently on the project and thread pages; the explore "Next page" link drops advanced filters; user ids on messages and conversations are readable by the other party; matching compares an hourly band with a total budget and ignores currency, and project languages are never populated; profiles are not premoderated and an approved project can still be edited.
1. **Real Supabase is unverified:** Realtime RLS, default grants and `pg_trgm` need the owner's project and `supabase test db` in CI.
2. Contact details in message text are not filtered (flag-and-review is an SP4 admin concern).
3. Seed limits and matching weights are placeholders for owner confirmation.
4. Public detail pages show the view's 400-character summary, not full text.
5. Public project teasers (view exists) and the per-user email preference are not built.
6. Recommendations use only the first provider organization of a user with several.
7. Placeholder-database page loads take about 14 s in e2e because the unreachable host times out; real deployments are not affected.
8. Search scale: the interface is prepared for an external engine if Postgres full-text stops being enough.

## Owner actions still needed
Create the Supabase, R2 and Vercel projects and enter secrets yourself; set `NEXT_PUBLIC_SITE_URL`; optionally `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` plus a scheduler hitting `/api/cron/notify-email`; confirm placeholder limits and weights; confirm Stripe Connect availability before Sub-project 3.

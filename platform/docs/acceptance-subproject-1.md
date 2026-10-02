# Sub-project 1 (Foundation) — acceptance record

Run date: 2026-10-02 · Branch: `feat/foundation` (local repo; not yet pushed — no GitHub access in the build session).
Legend: **VERIFIED** = observed passing in this session · **PARTIAL** · **NOT VERIFIED** = blocked, needs the owner's accounts/secrets or a live service. Nothing marked NOT VERIFIED may be assumed to work.

## Evidence run (fresh, same session)
| Check | Result |
|---|---|
| `pnpm lint` | 0 errors, 1 intentional warning (MFA full-page navigation) |
| `pnpm typecheck` | 0 errors |
| `pnpm test` (Vitest) | 17 files, 114 tests passed |
| `scripts/db-test.sh` (Postgres 16 + pgTAP + Supabase auth shim) | 47 assertions passed; RLS coverage OK |
| `pnpm build` (Next 16) | success without any secrets |
| `pnpm e2e` (Playwright, real Chromium, desktop + Pixel 7 viewport, `next start`) | 22 passed |
| `pnpm audit --prod` | no known vulnerabilities |
| secret-pattern scan of tracked files | clean; no `.env` tracked |

## Self-review fixes (each written test-first, RED then GREEN)
1. Re-running onboarding could lift a suspension or reset a verified PGAN expert to pending → profile with a persona is never rewritten; suspension preserved.
2. The last owner could demote/remove themselves, orphaning an organization → `memberships_keep_owner` trigger (cascade org deletion still works).
3. `create_organization` was callable directly via the API without limit → capped by admin-editable `limits.max_orgs_per_user` (default 5, SQLSTATE 54000).
4. The proxy called Supabase Auth for every anonymous request → skipped when no auth cookie is present.
5. Spec says TOTP must be enforceable per role; nothing enforced it → platform-admin access now requires aal2 (redirect to `/mfa`; API 403 `mfa_required`).

## Spec §7 checklist
| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Tenant isolation proven for tenant tables | **VERIFIED (local) / NOT VERIFIED (real Supabase)** | pgTAP: cross-org select/insert denied, multi-org user sees only own orgs, removed member loses access immediately, viewer cannot update/self-promote, admin cannot mint owner, anon denied, platform_roles not self-grantable. Mutation test (policy → `using (true)`) turned tests red, restoring turned them green. Must re-run via `supabase test db` in CI on real Supabase (default-grant differences possible). |
| 2 | RBAC matrix | **PARTIAL** | `can`/`decideAccess`/`navFor` unit-tested (persona never grants access). Anonymous gating verified live and in browser (307 → `/signin?next=`, API 401). **NOT VERIFIED:** authenticated per-role route access (e.g. non-admin `/admin` → 403) — needs a live Supabase Auth. |
| 3 | Auth: sign-up, verification, sign-in, reset, TOTP | **NOT VERIFIED** | Code, schemas, onboarding logic (idempotent, persona→org mapping, `pgan_expert` pending) and builds exist; no live Supabase Auth/mail here. |
| 4 | Config: admin edits value, app reads it, audited, non-admin cannot | **PARTIAL** | pgTAP: non-admin update affects 0 rows; admin update writes `settings_history` with old/new/actor; seed values 500/200 bps, 999/1999¢, Enterprise null, Free 0. Settings service (TTL cache, schema validation) unit-tested. No admin UI yet (sub-project 4). |
| 5 | Security: CI green, headers, rate limit | **PARTIAL** | Headers/CSP/nonce verified live and in browser; rate limiter unit-tested (memory + Upstash mock + fallback) and wired into auth/onboarding/upload; upload validation, safe redirects, webhook HMAC/idempotency, audit immutability tested. **NOT RUN:** gitleaks, dependency-review, CodeQL (need GitHub), live rate-limit abuse test against a real instance. |
| 6 | Delivery: PR→preview→staging→prod, rollback, restore | **NOT VERIFIED** | Workflows, protections config, runbooks written and YAML-validated; nothing executed (no GitHub/Vercel/Supabase access). Restore drill table intentionally blank. |
| 7 | Docs | **VERIFIED** | architecture, environments, secrets, ADR 0001/0002, runbooks (deploy, rollback, restore, incident). |

## Blockers to reach "fully verified" (owner action)
1. Grant push access / create the `papple` repo; run the kit's `apply-repo-settings.sh papple --dry-run` then apply.
2. Create Supabase staging + production projects, a Cloudflare R2 bucket (+ token), Vercel project; add secrets per `docs/secrets.md` (entered by the owner, not by Claude).
3. Run CI; fix anything real-Supabase exposes (grants, `config.toml` keys). Run authenticated e2e on staging. Rehearse rollback and the restore drill.
4. Confirm Stripe Connect Express availability for Papple World FZE LLC (ADR 0002) before sub-project 3.

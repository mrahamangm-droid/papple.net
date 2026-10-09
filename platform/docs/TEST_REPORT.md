# PAPple test report

Run date: 2026-10-09, commit `908abf0`, local Postgres 16 (auth shim) and Node.

| Suite | Command | Result |
|---|---|---|
| Database (pgTAP) | `bash scripts/db-test.sh` | PASSED, 1,147 assertions |
| Database races | `bash scripts/db-race-test.sh` | PASSED, races 1-20 |
| Unit and component | `npx vitest run` (in `apps/web`) | PASSED, 805 tests in 83 files |
| Types | `npx tsc --noEmit` | PASSED, no errors |
| Lint | `npx eslint src` | 0 errors, 1 warning (pre-existing `window.location.assign` in a client component) |
| End to end | Playwright, desktop project | 71 passed on the last run before the API slice was added to it; not re-run in this audit |

## What the tests cover

- Cross-tenant isolation and role checks at the database level (RLS and RPC authorization), including direct-RPC attempts, for every module.
- Concurrency: limit checks and one-shot actions under parallel requests (race tests).
- Server-side authorization, input validation, error mapping and rate limiting in the web layer.
- Public routes and gated routes anonymously (e2e).
- API keys: hashing, uniform 401, throttling before any database lookup, scoped reads.

## What is not tested

- Anything against real Stripe, Resend, R2, Upstash or hosted Supabase.
- A deployed site: none exists yet.
- Mobile and accessibility audits with tooling (manual component-level care only).
- Load and performance.
- Backup and restore on the hosted database.

A passing suite does not establish production readiness. The staging run-through (see the shared "PAPple staging run-through" doc) is the next gate.

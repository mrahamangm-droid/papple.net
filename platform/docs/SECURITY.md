# PAPple security overview

What is enforced today, where, and what is still open. Facts only; see `docs/architecture.md`, `docs/adr/0001-tenancy-rls.md` and `docs/secrets.md` for detail.

## Enforced in code and tested

- **Tenant isolation.** Every business table carries `org_id`; Postgres RLS plus `SECURITY DEFINER` helpers that read live membership, so removing a member takes effect at once. CI fails if any public table lacks RLS or a policy (`scripts/check-rls-coverage.sql`). Staging database: 57 public tables, 0 without RLS.
- **Default-deny public surface.** Anonymous access is limited to whitelisted views; base tables are closed.
- **Writes through RPCs.** Mutations take an explicit organization and re-check the caller's role. Money state is changed only by service-only RPCs after a verified webhook.
- **Authorization is server-side.** Navigation hiding is cosmetic; pages and route handlers re-check capability.
- **Payments.** PAPple never holds customer funds (Stripe Connect destination charges). Webhooks are signature-verified and idempotent. Clients cannot read or write payment state. Prices and commission come from server data and are snapshotted on each contract.
- **Audit log.** Append-only (blocked even for the service role), redacted payloads, salted IP hashes.
- **API keys.** `pap_` + 32 random bytes; only a SHA-256 hash and a prefix are stored; owner-only management; keys pause if the plan limit or the creator's owner role goes away; requests are throttled by address and by key before any database lookup.
- **Headers and sessions.** Strict nonce-based CSP, security headers, MFA-ready authentication (TOTP), safe redirect handling, rate limiting on sensitive actions.
- **Files.** Private storage with five-minute signed URLs, content validation on upload.
- **CI.** Dependency and secret scanning workflow, RLS test suite, migration workflow with a manual approval gate for production.

## Open items (owner or later work)

- Hosted Supabase: "Confirm email" and "Secure email change" must be ON before invitations are trusted (documented release gate).
- Upstash (global rate limiting) is optional but required before announcing the API; the in-memory fallback is per instance.
- No customer-facing webhooks, no key expiry, scopes or IP allow-lists for the API yet.
- Credential evidence is a link only; no file scanning pipeline for documents yet (arrives with the document store).
- Legal text is draft and unreviewed by a lawyer; invoices are not accountant-reviewed.
- Backup restoration has a runbook (`docs/runbooks/restore.md`) but has not been rehearsed on the hosted project.
- Real-provider behaviour (Stripe, Resend, R2) has not been exercised yet.

## Reporting

`/.well-known/security.txt` has no Contact line until the owner sets `securityContact` in `lib/legal.ts`; this is a launch blocker listed in `docs/launch-checklist.md`.

# PAPple read-only API access — design (slice 4 of PGAN & Enterprise)

## Goal
An organization owner creates API keys so the organization's own systems (BI tools, ATS, finance sheets) can read its projects, proposals, contracts and hiring analytics. Nothing can be changed, paid or sent through the API.

## Understanding
- Said (user answers): scope is "Read-only"; the answer on who manages keys was ambiguous ("1,2,3" to a two-option question). Ruling: **owners only** create and revoke keys (the recommended option). Cost if wrong: one line in the RPC role list and the page gate to add admins.
- Success: a developer gets a key in under a minute, calls four endpoints, sees only their organization's data, and an owner can kill a leaked key instantly.

## Non-goals (later)
Write endpoints, OAuth apps, webhooks to customers, per-key scopes, IP allow-lists, usage dashboards, SDKs, key expiry dates, admin management of keys.

## Keys
- Format `pap_<43 base64url chars>` (32 random bytes). Generated on the server; the secret is shown **once** and never stored. The database stores `sha256(secret)` (hex) and a display prefix (first 8 characters after `pap_`). A sha256 of a 256-bit random secret needs no salt.
- Owner-only create / revoke / list for an eligible active organization (`pool_eligible`: client, agency, enterprise). Plan limit `limits.api_keys` (active keys): default 0, professional_plus 0, business 2, enterprise 10 (a plan with no entry uses `default`; null = unlimited).
- Name 1 to 60 characters, trimmed, unique among the org's active keys is not required.
- Revoking is immediate and permanent (`revoked_at`). A revoked key can never authenticate again.
- Create and revoke write `audit_log` rows (`api_key.create`, `api_key.revoke`) with key id and prefix, never the hash.
- If the organization stops being active or eligible, its keys stop working (checked on every call). Added after review: a key also stops when the plan's `limits.api_keys` no longer covers it (0 = none; after a downgrade only the newest N keys work), and pauses while its creator is not an owner (works again if they are). The list shows who created each key and whether it is paused.
- Throttling happens before any database lookup: per caller address (120/min) then per key hash (60/min); the key list on the page is not counted against the action limit.

## Data (migration 0039)
- Table `api_keys(id, org_id, name, prefix, key_hash unique, created_by, created_at, last_used_at, revoked_at, revoked_by)`. RLS on, **no policies and no grants** to anon/authenticated: all access is through RPCs, so the hash is never readable by a client.
- Setting `limits.api_keys`.
- Owner RPCs (authenticated, SECURITY DEFINER): `api_key_create(p_org, p_name, p_prefix, p_hash) returns uuid`, `api_key_revoke(p_org, p_id)`, `api_keys_list(p_org) returns table(...)` (no hash). Errcodes: 42501 not allowed, 22023 invalid, 54000 limit, 23505 duplicate hash.
- Service-only RPC `api_key_authenticate(p_hash) returns uuid` (org id or null): active key, active eligible org; stamps `last_used_at` at most once per minute to avoid a write per call. Executable only by `service_role`.
- Service-only read RPCs, each taking the org id the authenticated key resolved to, keyset-paginated (`p_limit` 1..100, cursor `p_after_ts`, `p_after_id`), newest first, returning only the whitelisted fields below: `api_v1_projects`, `api_v1_proposals`, `api_v1_contracts`.
- `org_analytics` is split: `org_analytics_compute(p_org, p_days)` holds the existing computation (no caller check, service/definer use only), `org_analytics(p_org, p_days)` keeps its exact behavior and calls it after its checks. Same result, so 0038 tests stay valid. The API calls compute for the key's org with the same plan window cap.

## Endpoints (`GET` only, JSON, `Cache-Control: no-store`)
Auth: `Authorization: Bearer pap_...`. Any other method is 405. Missing, malformed, unknown or revoked key: 401 with the same body (never says which). Rate limit 60 per minute per key (429 with `Retry-After`). Bad query: 400 with a plain message. Server failure: 500 with a generic message.
- `/api/v1/projects?limit&after` — id, title, status, budget fields, currency, created_at, proposals_count.
- `/api/v1/proposals?limit&after&project_id` — id, project_id, provider organization name, status, price, currency, submitted_at. **No cover letter text, no emails.**
- `/api/v1/contracts?limit&after` — id, project_id, provider organization name, status, price, currency, created_at.
- `/api/v1/analytics?days` — the same object as the page, window capped by plan.
List responses: `{ "data": [...], "next": "<opaque cursor>" | null }`. The cursor is base64url of `created_at|id`, validated on input.

## Honest-data rules
Money is minor units plus currency, never summed across currencies. Provider names are organizations the caller already deals with. Nothing about individual users. Drafts: projects in draft are included with their status (the owner's own data); the API reports status and lets the consumer filter.

## Surfaces
- `/settings/api-keys` page for owners (under the already gated /settings prefix) (nav entry for owners): list (name, prefix, created, last used, status), create form (the secret is shown once after creation with a copy hint, then gone), revoke button, short usage example with the four endpoints. Non-owners and ineligible orgs see a plain explanation. Rate-limited action (`apikeys` 20/min per user).
- Failures are plain messages, never raw server text.

## Tests
pgTAP: owner-only authorization, limit by plan, hash not readable by authenticated, revoke permanent, authenticate (valid, revoked, unknown, inactive org, ineligible org, throttled last_used_at), each v1 RPC scoped to the org with other orgs excluded, pagination order and cursor, no cover letter field, anon and authenticated cannot execute service RPCs, `org_analytics` unchanged. vitest: key generator (format, hash, uniqueness), cursor encode/decode, request parsing, auth and error mapping in the route handler (401 uniform, 405, 429, 400, 500), service gate. e2e: `/settings/api-keys` anonymous gate and API 401 without a key.

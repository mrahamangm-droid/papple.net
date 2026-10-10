# Spend Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners of a client organization can require their approval before an admin accepts a contract at or above a threshold.

**Architecture:** One migration (0041) adds `spend_policies` and `spend_requests`, recreates `accept_contract` to return an outcome, and adds the decide, withdraw and policy RPCs. The web app gets a `lib/approvals` module in the same shape as `lib/team`: validators, an RPC-backed service with codes, presenters, and server actions. Two pages are added, and the contract buttons pass the new outcome through.

**Tech Stack:** Postgres 16 + pgTAP (`scripts/db-test.sh`), Next.js 16 App Router, zod 4, vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-papple-spend-approvals-design.md`

## Global Constraints
- Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate. Users never see database text.
- All writes are SECURITY DEFINER with `set search_path = public` and an explicit `p_org`. No direct table writes. RLS is on and `scripts/check-rls-coverage.sql` must stay clean.
- `threshold_minor` is an int in 0..2147483647. `currency` is `^[A-Z]{3}$`. A reject note is 1..500 characters after trimming.
- Notification payloads hold only `contract_id` and `request_id`, never amounts.
- Rate limit rule `approvals`: 30 per 60 s per user.
- Verify commands (from `platform/`): `bash scripts/db-test.sh`, `bash scripts/db-race-test.sh`, then from `platform/apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Review Focus
1. An admin calls `accept_contract` twice in parallel. Expect exactly one pending request (race test, Task 1).
2. An owner approves after the provider edited the milestones. Expect `lapsed` and the contract not accepted (pgTAP, Task 1).
3. An admin who made a request is promoted to owner. Expect them to still be unable to decide it (pgTAP, Task 1).
4. The contract currency differs from the policy currency and the price is below the threshold. Expect `approval_requested` (pgTAP, Task 1).
5. A policy amount like "1,000.50" or "-5" in the settings form. Expect `invalid`, never a silent rounding or a negative threshold (vitest, Task 2).

---

### Task 1: Database (migration 0041, pgTAP, race test)

**Files:**
- Create: `supabase/migrations/0041_spend_approvals.sql`
- Create: `supabase/tests/041_spend_approvals.test.sql`
- Modify: `scripts/db-race-test.sh` (add one case before the final summary)
- Modify: `supabase/migrations/README.md` (undo note)

**Interfaces:**
- Produces (SQL, all granted to `authenticated` only):
  - `spend_policy_set(p_org uuid, p_enabled boolean, p_threshold int, p_currency text) returns void`
  - `accept_contract(p_org uuid, p_contract uuid) returns text`, returning `accepted | approval_requested | approval_pending`
  - `spend_request_decide(p_org uuid, p_request uuid, p_approve boolean, p_note text) returns text`, returning `approved | rejected | lapsed`
  - `spend_request_withdraw(p_org uuid, p_request uuid) returns void`
  - Tables readable by org owners and admins:
    - `spend_policies(org_id, enabled, threshold_minor, currency, updated_by, updated_at)`
    - `spend_requests(id, org_id, contract_id, requested_by, status, price, currency, terms_hash, decided_by, decided_at, note, created_at)`
  - Notification types: `spend_approval_requested`, `spend_request_approved`, `spend_request_rejected`.
  - Audit actions: `spend_policy.set`, `spend_request.create|approve|reject|lapse|withdraw`.

- [ ] **Step 1: Write the failing pgTAP test.** Use the id prefixes `aaaaaa41-…` (users), `cccccc41-…` (orgs) and `eeeeee41-…` (projects, proposals, contracts), following `035_team.test.sql`.

  **Fixture:**
  - Client org C with users: owner `o`, second owner `o2`, admin `a`, admin `a2`, member `m`. Provider org P with owner `p`. Stranger `s`.
  - Two draft USD contracts created by insert, as superuser:
    - K1, price 50000, milestones 30000 + 20000.
    - K2, price 5000, one milestone.

  **Assertions** (`select plan(N)` with N equal to the count):
  1. Policy access:
     - `a`, `m`, `p` and `s` calling `spend_policy_set(C,…)` → `42501`.
     - `o` with threshold −1, or currency `usd` or `US` → `22023`.
     - `o` sets `(true, 10000, 'USD')` → one row. `a` can select it; `p` cannot (count 0).
  2. Accept outcomes:
     - `o` accepting K2 → `'accepted'`.
     - With the policy off, `a` accepting K1 → `'accepted'`. Then reset `accepted_by_client`.
     - With the policy on: `a` accepting K2 (5000 < 10000) → `'accepted'`.
     - `a` accepting K1 → `'approval_requested'`. `accepted_by_client` stays false, one pending request with price 50000 exists, and `o` and `o2` each have one `spend_approval_requested` notification whose payload has no `price` key.
     - `a2` accepting K1 → `'approval_pending'`; still one pending request.
     - `p` accepting K1 on the provider side → `'accepted'` (policy not applied).
  3. Currency: change the policy to `'EUR'` with threshold 100000. `a` accepting K2 → `'approval_requested'`. Withdraw it afterwards and restore `'USD'`/10000.
  4. Lapse on change: `set_milestones` on K1 by `p` (two new amounts summing to 50000). `a` accepting K1 → `'approval_requested'`, the old request is `'lapsed'`, and exactly one request is pending.
  5. Decide access:
     - `a`, `m`, `p` and `s` deciding → `42501`.
     - Promote `a` to owner (superuser update); `a` deciding their own request → `42501`; demote `a` again.
     - `o` rejecting with note `'  '` → `22023`.
  6. Approve: `o` approves → `'approved'`, K1 `accepted_by_client` = true, `decided_by` = `o`, and `a` has a `spend_request_approved` notification.
  7. Lapse at decision: create a new request on K1 (reset `accepted_by_client`, `a` accepts), `p` calls `set_milestones`, `o` approves → `'lapsed'` and `accepted_by_client` stays false.
  8. Reject: new request, `o` rejects with note `'Too high'` → `'rejected'`, and `a` is notified.
  9. Withdraw:
     - `a2` withdrawing `a`'s request → `42501`.
     - `a` withdrawing their own → ok, status `'withdrawn'`.
     - `o` withdrawing another admin's pending request → ok.
     - Deciding a non-pending request → `22023`.
  10. Cancelled contract: `cancel_contract` on a contract with a pending request, then `o` approves → `'lapsed'`.
  11. Direct writes: insert, update or delete on both tables as `o` → `42501`.
  12. Audit: `audit_log` has one or more rows for each of `spend_policy.set`, `spend_request.create`, `spend_request.approve`, `spend_request.reject`, `spend_request.lapse` and `spend_request.withdraw` for org C.

- [ ] **Step 2: Run it to see it fail.** Run `bash scripts/db-test.sh`. Expected: `041_spend_approvals` fails (`function spend_policy_set … does not exist`), while every other file still passes.

- [ ] **Step 3: Write `0041_spend_approvals.sql`.**
  - **Header comment:** purpose, errcodes and an undo note, in the 0040 style.
  - **Tables** as in the spec, with checks:
    - `status in ('pending','approved','rejected','withdrawn','lapsed')`
    - `char_length(note) <= 500`
    - `currency ~ '^[A-Z]{3}$'`
    - `threshold_minor between 0 and 2147483647`
  - **Indexes:** `create unique index spend_requests_one_pending on spend_requests (org_id, contract_id) where status = 'pending'` and `(org_id, created_at desc)`.
  - **Access:** RLS on, `revoke all … from public, anon, authenticated`, `grant select` on both tables to authenticated, and a select policy `has_org_role(org_id, array['owner','admin'])` on each.
  - **`spend_terms_hash(p_contract uuid) returns text`** (stable, definer, revoked from all client roles):
    ```sql
    md5(coalesce(string_agg(position || '|' || title || '|' || amount || '|' || coalesce(due_date::text,''), E'\n' order by position), ''))
    ```
    over `milestones where contract_id = p_contract`.
  - **`drop function public.accept_contract(uuid, uuid);`** then recreate it returning text. Keep all existing checks verbatim, in this order:
    1. auth
    2. role owner/admin
    3. lock the contract row `for update`
    4. side membership
    5. draft
    6. milestone sum
  - Then, when `p_org = client_org_id` and the caller is not an owner (`not has_org_role(p_org, array['owner'])`), and an enabled policy exists where (`currency <> v_c.currency` or `v_c.price >= threshold_minor`):
    - Look up the pending request.
    - If it exists and its price, currency and hash all match the current values → return `'approval_pending'`.
    - If it exists but differs → set it to `lapsed`, with an audit row `spend_request.lapse`.
    - Insert a new pending request, add an audit row `spend_request.create`, notify each owner of `p_org` (loop over memberships with role `owner`, calling `notify(user, 'spend_approval_requested', {contract_id, request_id})`), and return `'approval_requested'`.
  - Otherwise set the acceptance flag exactly as before and return `'accepted'`.
  - Re-grant execute on the new `accept_contract` to authenticated only.
  - **`spend_request_decide`:**
    1. Require an owner of `p_org`.
    2. Lock the request `for update` and require `org_id = p_org` (else 42501), `requested_by <> auth.uid()` (else 42501) and `status = 'pending'` (else 22023).
    3. On reject, require the trimmed note to be 1..500 characters (else 22023).
    4. Lock the contract.
    5. On approve, if the contract is not `draft`, or the price, currency or `spend_terms_hash` differ from the snapshot, or the milestone sum ≠ price → set `lapsed`, audit, and return `'lapsed'`.
    6. Otherwise set `approved`, `decided_by`, `decided_at`, set `accepted_by_client = true`, audit, notify the requester, and return `'approved'`.
    7. Reject: set `rejected` with the note, audit, notify, and return `'rejected'`.
  - **`spend_request_withdraw`:** the caller must be an owner/admin of `p_org`. The request must be in `p_org` and pending (else 22023). The caller must be the requester or an owner (else 42501). Set `withdrawn` and audit.
  - **`spend_policy_set`:** owner only. Validate (22023). Upsert, then audit with the before row (or null) and the after row.
  - **Grants:** revoke execute on the four RPCs from public and anon, and grant to authenticated.

- [ ] **Step 4: Run the suite.** Run `bash scripts/db-test.sh`. Expected: `RLS coverage OK` and `DB TESTS PASSED`, including every 041 assertion, with no regressions in `015_contracts.test.sql` (its `accept_contract` calls now return text; any test that does `select accept_contract(...)` still passes).

- [ ] **Step 5: Add the race case to `scripts/db-race-test.sh`.**
  - Set up a client org with an owner and two admins, and a provider org with an owner.
  - Create a draft contract, price 50000, with one milestone of 50000.
  - Set the policy `(true, 1000, 'USD')` via SQL insert.
  - Run `hold` with 6 parallel `as <admin> "select accept_contract(...)"` calls, alternating the two admins.
  - `check "one pending spend request under parallel accepts"` → count of pending requests = 1.
  - Run `bash scripts/db-test.sh && bash scripts/db-race-test.sh`. Expected: `RACE TESTS PASSED`.

- [ ] **Step 6: Add the README undo note and commit.**
  ```bash
  git add supabase/ scripts/db-race-test.sh
  git commit -m "Spend approvals: migration 0041, pgTAP and race tests"
  ```

### Task 2: Approvals library and server actions

**Files:**
- Create: `apps/web/src/lib/approvals/present.ts`, `present.test.ts`, `service.ts`, `service.test.ts`
- Modify: `apps/web/src/lib/ratelimit.ts` (rule `approvals: { limit: 30, windowSec: 60 }`)
- Modify: `apps/web/src/lib/server.ts` (export `approvalsService(revalidate)`, wired like `teamService`)
- Create: `apps/web/src/app/(app)/approvals-actions.ts` ("use server" wrappers `setSpendPolicyAction`, `decideSpendRequestAction`, `withdrawSpendRequestAction`)

**Interfaces:**
- Consumes: the Task 1 RPCs.
- Produces:
  - `type ApprovalFailure = "forbidden" | "invalid" | "duplicate" | "rate" | "error"`
  - `createApprovalsService(deps: { getUserId; throttle(userId) => Promise<boolean>; rpc(fn, args) => Promise<{data; error: {code?: string} | null}>; revalidate(path) })` returning:
    - `setPolicy(raw: unknown): Promise<{ok:true} | {ok:false; code}>`. The input is `{orgId, enabled, amount: string, currency}`. `amount` is a major-unit string matching `^\d{1,9}(\.\d{1,2})?$` (no commas or signs), converted with `toMinor(Number(amount), currency)`, and anything over 2147483647 is `invalid`. `currency` is trimmed and upper-cased, `^[A-Z]{3}$`.
    - `decide(raw): Promise<{ok:true; outcome: "approved"|"rejected"|"lapsed"} | {ok:false; code}>`. The input is `{orgId, requestId, approve: boolean, note: string ≤500}`. A reject with a blank note is `invalid` client-side.
    - `withdraw(raw): Promise<{ok:true} | {ok:false; code}>`
    - Every success revalidates `/approvals` and `/contracts/<id>` when known, and `setPolicy` revalidates `/settings/approvals`.
  - `present.ts`:
    - `requestStatusLabel(s)`: pending "Waiting for an owner", approved "Approved", rejected "Rejected", withdrawn "Withdrawn", lapsed "Lapsed (terms changed)", anything else "Unknown"
    - `approvalFailureMessage(code)`
    - `acceptOutcomeMessage(o)`: `approval_requested` and `approval_pending` → "Sent to your organization's owners for approval."; `accepted` → null
    - `approvalNotificationCopy(type, payload) → {text, href} | null`: requested → "A contract is waiting for your approval." with href `/approvals`; approved → "Your contract approval was granted." with href `/contracts/<contract_id>`; rejected → "Your contract approval was declined." with href `/approvals`
    - `canDecide(role, requestedBy, userId)`: owner and not the requester
    - `canWithdraw(role, requestedBy, userId)`

- [ ] **Step 1: Write failing tests.**
  - **`present.test.ts`:**
    - Each label.
    - `approvalNotificationCopy` for the three types, with an unknown type returning null and the text containing no digits even when the payload has `price`.
    - `canDecide("owner", "u1", "u1") === false` and `canDecide("admin", "u2", "u1") === false`.
  - **`service.test.ts`**, with fake deps:
    - Signed out → `forbidden`. Throttle false → `rate`.
    - `setPolicy` amounts `"1,000.50"`, `"-5"`, `"1e3"`, `"21474837"` (over the cap with 2 decimals) → `invalid`, with rpc not called.
    - `"100.5"` in USD → rpc `spend_policy_set` with `p_threshold: 10050, p_currency: "USD"`.
    - Lowercase `"usd"` is accepted as `USD`.
    - rpc error `42501` → `forbidden`, `22023` → `invalid`, a thrown error → `error`.
    - `decide` reject with note `"  "` → `invalid`, with no rpc call.
    - `decide` returns `{ok:true,outcome:"lapsed"}` when the rpc returns `"lapsed"`.
    - An unexpected rpc data value → `error`.
- [ ] **Step 2: Run them to see them fail.** Run `pnpm -C apps/web test src/lib/approvals`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `present.ts` and `service.ts`** to the interfaces above, mirroring `lib/team/service.ts` (gate → call → codes). Add the rate rule, the server wiring and the actions file.
- [ ] **Step 4: Run again.** Run `pnpm -C apps/web test src/lib/approvals && pnpm -C apps/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Spend approvals: library, rate rule and server actions".

### Task 3: Contract accept outcome

**Files:**
- Modify: `apps/web/src/lib/contracts/db.ts` (`acceptContract` returns `Promise<AcceptOutcome>`, with `type AcceptOutcome = "accepted" | "approval_requested" | "approval_pending"`; anything else throws `MarketplaceError`)
- Modify: `apps/web/src/lib/contracts/actions.ts` (`ContractActionResult` success gains `outcome?: AcceptOutcome`; `acceptContract` returns it)
- Modify: `apps/web/src/lib/contracts/db.test.ts`, `actions.test.ts`
- Modify: `apps/web/src/components/contracts/ContractButtons.tsx` (after accept, when `acceptOutcomeMessage(r.outcome)` is non-null, show it in the existing status area instead of treating it as done)

**Interfaces:**
- Consumes: `acceptOutcomeMessage` from Task 2.
- Produces: `actions.acceptContract(i) → {ok:true; outcome} | {ok:false; code}`.

- [ ] **Step 1: Write failing tests.**
  - `db.test.ts`: rpc data `"approval_requested"` → resolves to that string; data `"bogus"` → rejects.
  - `actions.test.ts`: `acceptContract` with the db returning `"approval_pending"` → `{ok:true, outcome:"approval_pending"}`, revalidating the contract paths.
- [ ] **Step 2: Run them to see them fail.** Run `pnpm -C apps/web test src/lib/contracts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement the changes** listed under Files.
- [ ] **Step 4: Run again.** Run `pnpm -C apps/web test src/lib/contracts && pnpm -C apps/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Spend approvals: contract accept passes the approval outcome through".

### Task 4: Pages, navigation, notifications, e2e, docs

**Files:**
- Create: `apps/web/src/app/(app)/approvals/page.tsx`, `apps/web/src/app/(app)/settings/approvals/page.tsx`, `apps/web/src/components/approvals/ApprovalForms.tsx` (client: `PolicyForm`, `DecideButtons` with a note field required for reject, `WithdrawButton`)
- Modify: `apps/web/src/lib/route-gate.ts` (add `"/approvals"` to `PROTECTED_PREFIXES`) and `route-gate.test.ts` (protects `/approvals`, leaves `/approvalsx` public)
- Modify: `apps/web/src/lib/rbac.ts` (owners and admins get `{ href: "/approvals", label: "Approvals" }`) and `rbac.test.ts` (owner and admin have it; member and viewer don't)
- Modify: `apps/web/src/app/(app)/notifications/page.tsx` (fall back to `approvalNotificationCopy`)
- Modify: the contract detail page `apps/web/src/app/(app)/contracts/[id]/page.tsx` (banner when the viewer is an owner/admin of the client org and a pending `spend_requests` row exists for this contract; the select is RLS-bound, so the provider gets no rows)
- Create: `apps/web/e2e/approvals-anonymous.spec.ts` (`/approvals` and `/settings/approvals` redirect to sign-in, following `contracts-anonymous.spec.ts`)
- Modify: `README.md` (platform) with a "Spend approvals (procurement slice 1)" section; `docs/PROJECT_STATUS.md` and `docs/PROJECT_AUDIT.md` (procurement row PARTIAL: spend approvals built); create `docs/acceptance-spend-approvals.md` (what is verified by pgTAP, race and vitest; NOT VERIFIED: signed-in flows end to end without live Supabase Auth)

**Interfaces:**
- Consumes: Task 2 actions and presenters; Task 1 tables (select).

**Pages:**
- **`/approvals?org=`:** pick the org as in `settings/team/page.tsx`.
  - Members and viewers see "Only owners and admins can see approvals."
  - Otherwise select pending requests (oldest first), then the last 50 decided requests (newest first), joined to the contract title and price, plus `profiles.display_name` for the requester.
  - Each pending row shows the title (linked), `formatMinor(price, currency)`, the requester, the date, and controls per `canDecide` / `canWithdraw`.
- **`/settings/approvals?org=`:** shows the policy state in words (for example "Contracts of USD 100.00 or more accepted by an admin need an owner's approval"), or "No approval rule". `PolicyForm` is for owners only; admins see the policy read-only.

- [ ] **Step 1: Write the failing tests:** the route-gate and rbac cases above.
- [ ] **Step 2: Run them to see them fail.** Run `pnpm -C apps/web test src/lib/route-gate src/lib/rbac`. Expected: FAIL.
- [ ] **Step 3: Implement** the gate, nav, pages, forms, banner, notification fallback, e2e spec and docs.
- [ ] **Step 4: Full verification.** From `platform/`: `bash scripts/db-test.sh && bash scripts/db-race-test.sh`. From `platform/apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all pass with 0 lint errors. Then run `pnpm exec playwright test e2e/approvals-anonymous.spec.ts` against `pnpm start` if Playwright's Chromium is available (`/opt/pw-browsers`); otherwise record that it was not run.
- [ ] **Step 5: Commit** with the message "Spend approvals: pages, navigation, notifications, e2e gate and docs".

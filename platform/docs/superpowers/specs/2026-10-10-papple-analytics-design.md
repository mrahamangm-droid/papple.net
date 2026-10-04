# PAPple hiring analytics — design (slice 3 of PGAN & Enterprise)

## Goal
Owners and admins of client, agency and enterprise organizations see how their hiring performs on PAPple: what they posted, what came back, how fast they hire, what they committed and paid, and whether their talent pools and invitations work. Numbers are the organization's own, computed live from existing data, and every figure says what it counts.

## Understanding
- Said: "Enterprise analytics." Assumed: buyer-side hiring analytics (the organization as client). Provider-side earnings analytics is a different feature and not included.
- Success: an enterprise lead answers "are we hiring faster, what are we spending, are invitations worth it" without a spreadsheet, and never sees a misleading number.

## Non-goals (later)
CSV export, scheduled email reports, cross-organization benchmarks, forecasting, provider-side earnings, per-user breakdowns, charts beyond a simple monthly table.

## Honest-numbers rules
1. **Never add currencies together.** Money is a list, one row per currency.
2. Amounts are minor units (cents/fils) formatted with the existing money helper.
3. A ratio with no denominator shows "Not enough data yet", never 0% or NaN.
4. Each metric has a one-line definition on the page.
5. The window is the last 30, 90 or 365 days, capped by plan (`limits.analytics_days`: 30 / 90 / 365 / 365 on Enterprise). A request above the cap is clamped and the page says so.

## Data (migration 0038, no new tables)
One read-only SECURITY DEFINER function `org_analytics(p_org uuid, p_days int) returns jsonb`. Caller must be owner or admin of `p_org`; the organization must be a client-side type (`client_company`, `enterprise`, `agency`) and active (42501 / 22023). `p_days` must be 1 to 3650 (22023), then clamped to the plan cap. A plan without its own entry uses the `default` entry (via `org_limit`); a null value means 3650.

Definitions, all scoped to `p_org` and the window `[now - days, now]`:
- **Posted**: projects created in the window whose status is not `draft`; with counts by status open / closed / cancelled (other statuses count only in the total).
- **Proposals**: proposals on those posted projects: received (all), shortlisted (shortlisted or hired); average per posted project (null if none posted).
- **Hiring**: accepted contracts (status active, completed or disputed; a draft offer is not a hire) of the org created in the window. Hire rate = posted projects (window cohort) that have a non-cancelled contract / posted. Median days to hire = median of (contract created minus project created) over those contracts (null if none).
- **Contracts** created in the window, by status draft / active / completed / disputed / cancelled.
- **Money per currency**: committed = sum of price of accepted contracts created in the window; paid = sum of milestone amounts of succeeded or refund-pending payments with `paid_at` in the window; fees = client fees of those payments; refunded = `client_total` (amount plus fee, what goes back to the client) of payments in status refunded whose last update is in the window.
- **Top providers**: up to 5 provider organizations by number of non-cancelled contracts in the window, with committed value in that contract currency (one row per provider and currency, providers ranked first).
- **Talent**: pools (count), pooled professionals still public (distinct), invitations sent in the window, declined, and invited professionals who then sent a proposal to the same project after the invitation and have not withdrawn it; invitation-to-proposal rate (null if none sent).
- **Monthly**: UTC calendar months from the window start to this month, empty months as zeros, latest 13 at most (first and current month partial): projects posted and accepted contracts created.

## Surfaces
- `/analytics` (nav entry for owners/admins): organization picker via `?org`, window picker via `?days=30|90|365`, KPI tiles, money table, contracts and funnel, top providers, talent, monthly table, definitions.
- Failure is shown as a plain message, never raw server text.
- Rate-limited (`analytics`, 30 per minute per user).

## Privacy
Only the caller's own organization's data. Provider names shown are organizations the caller already contracted. No individual user data. No data is written.

## Tests
pgTAP: authorization (viewer/member/outsider/non-eligible org), window clamp, each metric against fixtures including two currencies, empty org returns zeros and nulls, other org's data excluded, refunds and fees. vitest: response parser (defensive against odd JSON), formatters, service gate and error mapping. e2e route gating.

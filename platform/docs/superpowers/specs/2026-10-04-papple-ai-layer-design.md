# PAPple AI layer (v1) — design

Status: design approved by the owner in chat on 2026-10-04 ("Approve, build it"); owner delegated spec and plan review ("do it for me").

## Goal
Optional AI writing help that never acts on its own: draft a proposal, polish a profile or service description, improve a project brief. Metered per organization, switchable off in one place, nothing private stored.

## Rules
- Suggestion only. Output fills a text box the person edits and sends. AI never submits, messages, or changes data.
- Off by default: feature flag `ai.assistant` (exists, default false) is the kill switch. No `ANTHROPIC_API_KEY` means every AI button is hidden.
- Untrusted text (other users' briefs, profiles) goes to the model inside delimited blocks the system prompt declares to be data; delimiter look-alikes are stripped. Private messages are never sent.
- `ai_usage` stores user, organization, feature, token counts and outcome. Never prompts or answers.
- Provider keys are never stored in the database or `platform_settings`.

## Data (migration 0029_ai.sql)
- `ai_usage(id, user_id, org_id, feature, tokens_in, tokens_out, outcome, created_at)`; feature in `proposal_draft | polish_profile | polish_service | improve_brief`; outcome in `reserved | ok | error`. RLS on, no direct grants; users never read it.
- `ai_reserve(p_org uuid, p_feature text) returns uuid` (security definer, signed-in, `is_member(p_org)`): refuses with 42501 when the flag `ai.assistant` (with per-org override) is off or the caller is not a member; 22023 for an unknown feature; 54000 when the organization's monthly allowance (`org_limit(p_org,'ai.monthly_message_limits')`, null = unlimited) or the global daily cap (`ai.daily_request_cap`, new setting, default 2000, null = unlimited) is used up. Counts rows with outcome `reserved` or `ok`, so failed calls never consume allowance. Serialised with an advisory lock. Inserts a `reserved` row and returns its id.
- `ai_finish(p_id uuid, p_in int, p_out int, p_outcome text)`: only the row's owner, only while `reserved`, outcome `ok|error`; token counts clamped to 0..1,000,000.
- `ai_usage_summary(p_days int default 30)`: admin + aal2 (existing `staff_guard` pattern, admin-only), returns per feature and per organization counts and token sums for the window (days clamped 1..90).
- Settings registry gains `ai.daily_request_cap` (count, 0..1,000,000, nullable not editable via UI: 0 means off). Existing `ai.monthly_message_limits` and flag `ai.assistant` are edited in the existing admin screens.

## Server (apps/web/src/lib/ai)
- `prompts.ts`: pure builders `proposalPrompt`, `polishPrompt`, `briefPrompt`, `fence(text, max)`; every untrusted field is truncated and fenced.
- `client.ts`: `AiClient { complete({system,user,maxTokens}) → {text,tokensIn,tokensOut} }`; `createAnthropicClient({key, model, fetch, timeoutMs})` over the Messages API with fetch (no SDK). Any failure throws `AiUnavailableError` with a generic message.
- `service.ts`: `createAiService(deps)` with `draftProposal`, `polish`, `improveBrief`. Flow: validate → `ai_reserve` → load context (RLS-bound) → build prompt → client → `ai_finish` → `{ok:true,text}` or `{ok:false,code}` where code in `forbidden | invalid | limit | rate | unavailable | error`. Output is trimmed, stripped of control characters, capped to the target field's maximum, and never raw HTML.
- Env: `ANTHROPIC_API_KEY` (optional), `AI_MODEL` (optional, default `claude-sonnet-5-5`).
- Rate limit rule `ai` (10 per minute per user) on top of the plan allowance.
- Server actions in `app/(app)/ai-actions.ts`; client `AiAssist` button wired into ProposalForm (cover letter), ProfileForm (summary), ServiceForm (description), ProjectForm (description).

## Admin
`/admin/ai`: usage by feature and by organization for 7/30/90 days, the flag and cap state, links to the settings screen. Read-only; changes happen in existing audited screens.

## Privacy and legal
Privacy policy lists Anthropic as a processor for the optional AI assistant, states it receives only what the person submits for that request, and is not used for chat messages.

## Out of scope
Semantic matching or embeddings, auto replies, chat summarisation, per-user budgets, streaming output, storing prompts.

## Review focus
Flag off or unknown org; non-member reserving for someone else's org; allowance exhausted at the boundary; two concurrent reservations at the limit; failed model call refunding allowance; prompt injection through a project brief; model output containing HTML or oversized text; key missing; admin summary without aal2; usage rows never containing prompt text.

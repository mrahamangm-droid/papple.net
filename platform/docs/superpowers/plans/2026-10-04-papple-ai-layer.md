# PAPple AI layer Implementation Plan

> Execution: superpowers:executing-plans (inline), by owner delegation.

**Goal:** Metered, optional, suggestion-only AI writing help.
**Architecture:** DB reserves/records usage; pure prompt builders; fetch-based Anthropic adapter behind an interface; thin server actions and one client button.
**Tech Stack:** Postgres/pgTAP, Next.js, vitest.
**Spec:** docs/superpowers/specs/2026-10-04-papple-ai-layer-design.md

## Global Constraints
- Never store prompts or answers. No keys in DB. Flag `ai.assistant` default off. Errcodes 42501 / 22023 / 54000.
- Failed model calls do not consume allowance.

## Review Focus
See spec "Review focus".

### Task 1: Database (0029_ai.sql + pgTAP 029)
Produces `ai_usage`, `ai_reserve`, `ai_finish`, `ai_usage_summary`, setting `ai.daily_request_cap`.
- [ ] RED pgTAP: flag off → 42501; unknown feature → 22023; non-member → 42501; monthly limit hit → 54000; error outcome frees allowance; daily cap → 54000; finish by other user refused; double finish refused; summary needs admin+aal2; no direct table access.
- [ ] GREEN migration. Run `bash scripts/db-test.sh`.
### Task 2: Prompts + client + service (vitest)
Files `lib/ai/{prompts,client,service}.ts` + tests. Produces `createAiService`, `AiResult`, `AiClient`.
- [ ] RED/GREEN per spec incl. injection fencing, truncation, output sanitising, limit never calls client, error finishes `error`, generic failure text.
### Task 3: Wiring (env, server.ts, actions, rate rule, UI)
`lib/env.ts` optional vars; `lib/ratelimit.ts` rule `ai`; `lib/server.ts` `aiService`, `aiAvailable()`; `app/(app)/ai-actions.ts`; `components/marketplace/AiAssist.tsx`; forms; settings-registry entry.
- [ ] Tests: actions return codes and respect throttle; registry validates cap; component helper `aiFill` logic pure-tested.
### Task 4: Admin screen, privacy text, docs, e2e
`lib/admin/db.ts` + actions-free read, `app/(app)/admin/ai/page.tsx`, nav link, privacy text + test, docs, launch checklist (ANTHROPIC_API_KEY).
- [ ] Full suite: pgTAP, race, vitest, tsc, eslint, build, playwright.

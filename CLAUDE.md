# CLAUDE.md

Guidance for Claude working in this repo.

## What this is

Papple.net is the corporate site for Global Advisory, Construction Intelligence and the Verified Expert Network. It's a Next.js 16 App Router app (TypeScript strict, Tailwind CSS 3, next-auth 4) deployed on Vercel.

**README.md vs. reality:** README.md describes Builds 1–4.1 (advisory pages, six intelligence tools, PGAN expert workflow, accounts, Stripe, AI assistant, enterprise dashboards). Most of that code is **not in this repo**. `src/app` currently has only a minimal homepage (`page.tsx`, `layout.tsx`, `globals.css`) plus `src/types/next-auth.d.ts`. `src/proxy.ts` is forward-compatible auth-gating scaffolding for paths that don't exist yet. Don't assume a feature works because README.md mentions it. Check `src/` first.

**`platform/`** is a separate pnpm monorepo (the PAPple marketplace: `apps/web` Next.js app, `supabase/` migrations and pgTAP tests, `docs/`). It has its own CLAUDE.md, verify commands and status (`platform/docs/PROJECT_STATUS.md`). The root `tsconfig.json` excludes it, but the root `eslint .` still lints it.

## Current merge policy

`main` is the default and production branch (Vercel deploys from it). Open a PR from a feature or `claude/*` branch and stop. Never push to `main` and never merge yourself unless a human asks in that specific request. Don't merge major-version dependency bumps without explicit approval.

## Before calling anything done

```
npm ci && npm run lint && npm run typecheck && npm run build
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, lint and typecheck on Node 20. `package-lock.json` must stay in sync with `package.json`. When Dependabot PR #2 (`@types/node` 26.6.2) merged, the lockfile drifted and `npm ci` failed on `main` until the repo-setup PR resynced it. There is no test suite yet.

## Invariants

- **Next 16 conventions**: request interception lives in `src/proxy.ts` (exported `proxy`, Node.js runtime). Don't reintroduce `middleware.ts`, which is deprecated.
- **Dependabot groups** minor and patch updates (`.github/dependabot.yml`). Each major bump arrives as its own PR and must be tested.
- **Never commit secrets**: `DATABASE_URL`, NextAuth, Stripe, Anthropic and Google OAuth credentials belong in Vercel or `.env.local`, never in code.

## Current state (2026-10-10)

- Open issue: #19 (follow-ups after repo setup).
- React 19 is merged. `middleware.ts` → `src/proxy.ts` and CI → `npm ci` are done on `claude/vibrant-noether-6e5n36`.
- Open Dependabot PRs: #38 (minor/patch group), #39 ESLint 10, #12 TypeScript 7, #13 Tailwind 4, #17 actions/setup-node 7, #18 actions/checkout 7. Hold ESLint 10, TS 7 and Tailwind 4 for the reasons below.
  - ESLint 10: lint crashed (`scopeManager.addGlobals is not a function`) because `eslint-config-next` wasn't ESLint 10-ready.
  - TypeScript 7: `baseUrl` was removed (TS5102) and typescript-eslint doesn't support TS 7.
  - Tailwind 4: needs `@tailwindcss/postcss` and a CSS-config migration.
- Repo hygiene: Dependabot (npm + github-actions, weekly), SECURITY.md and a CodeQL workflow are in place.

## Next steps

1. Check Vercel deployments (see #19 and `platform/docs/PROJECT_STATUS.md`; the owning team has a failed-payment notice).
2. Decide whether to restore the Build 1–4.1 features README.md describes, or trim README.md to match the code.
3. Revisit ESLint 10, TS 7 and Tailwind 4 once upstream tooling supports them, as dedicated migration PRs.

## Scope

Keep PRs focused on what was asked, and list anything you noticed but didn't fix in the PR description. Flag anything ambiguous about auth, billing or secrets instead of guessing.

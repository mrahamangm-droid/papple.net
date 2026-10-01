# CLAUDE.md

Guidance for Claude working in this repo.

## What this is

Papple.net is the corporate site for Global Advisory, Construction Intelligence and the Verified Expert Network. It's a Next.js 16 App Router app (TypeScript strict, Tailwind CSS 3, next-auth 4) deployed on Vercel.

**README.md vs. reality:** README.md describes Builds 1–4.1 (advisory pages, six intelligence tools, PGAN expert workflow, accounts, Stripe, AI assistant, enterprise dashboards). Most of that code is **not in this repo**. `src/app` currently has only a minimal homepage (`page.tsx`, `layout.tsx`, `globals.css`) plus `src/types/next-auth.d.ts`. `middleware.ts` is forward-compatible auth-gating scaffolding for paths that don't exist yet. Don't assume a feature works because README.md mentions it. Check `src/` first.

## Current merge policy

`main` is the default and production branch (Vercel deploys from it). Open a PR from a feature or `claude/*` branch and stop. Never push to `main` and never merge yourself unless a human asks in that specific request. Don't merge major-version dependency bumps without explicit approval.

## Before calling anything done

```
npm ci && npm run lint && npm run typecheck && npm run build
```

CI (`.github/workflows/ci.yml`) runs `npm install`, lint and typecheck on Node 20. `package-lock.json` must stay in sync with `package.json`. When Dependabot PR #2 (`@types/node` 26.6.2) merged, the lockfile drifted and `npm ci` failed on `main` until the repo-setup PR resynced it. There is no test suite yet.

## Invariants

- **Next 16 conventions**: Next 16 renamed `middleware.ts` to `proxy.ts`. The build still accepts `middleware.ts`, but plan the rename (a separate, reviewed change).
- **Dependabot groups** minor and patch updates (`.github/dependabot.yml`). Each major bump arrives as its own PR and must be tested.
- **Never commit secrets**: `DATABASE_URL`, NextAuth, Stripe, Anthropic and Google OAuth credentials belong in Vercel or `.env.local`, never in code.

## Current state (2026-10-01)

- Open issues: none.
- Open PRs, all Dependabot (tested on 2026-10-01, with results commented on each PR):
  - #9 react-dom 19 and #11 react 19: each fails `npm ci` alone (ERESOLVE), but together they pass lint, typecheck and build. Safe to merge together.
  - #10 ESLint 10: lint crashes (`scopeManager.addGlobals is not a function`) because `eslint-config-next` 16.3.6 isn't ESLint 10-ready. Hold.
  - #12 TypeScript 7: `baseUrl` was removed (TS5102) and typescript-eslint doesn't support TS 7. Hold.
  - #13 Tailwind 4: the build fails because it needs `@tailwindcss/postcss` and a CSS-config migration. Hold.
- Repo hygiene: Dependabot (npm + github-actions, weekly), SECURITY.md and a CodeQL workflow are in place.

## Next steps

1. Merge #9 and #11 together (React 19), then smoke-test the deployed homepage.
2. Decide whether to restore the Build 1–4.1 features README.md describes, or trim README.md to match the code.
3. Rename `middleware.ts` to `proxy.ts` for Next 16.
4. Consider switching CI to `npm ci` now that the lockfile is committed and in sync.
5. Revisit ESLint 10, TS 7 and Tailwind 4 once upstream tooling supports them, as dedicated migration PRs.

## Scope

Keep PRs focused on what was asked, and list anything you noticed but didn't fix in the PR description. Flag anything ambiguous about auth, billing or secrets instead of guessing.

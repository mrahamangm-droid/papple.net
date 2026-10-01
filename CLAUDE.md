# CLAUDE.md

Guidance for Claude working in this repo.

## What this repo is

papple.net: the Papple corporate/advisory website. Next.js 16 App Router,
TypeScript strict, Tailwind, deployed on Vercel.

## Current state (2026-10-01)

**The README and the code don't match.** `README.md` describes Builds 1–4
(advisory pages, six Construction Intelligence tools, PGAN expert workflow,
NextAuth accounts, Stripe billing, the Claude-backed advisory assistant,
Prisma/Postgres). The repo itself only holds a minimal homepage
(`src/app/page.tsx`, `layout.tsx`, `globals.css`), `middleware.ts`, a
NextAuth type augmentation and config: 18 tracked files in total. There is
no `prisma/`, `src/lib/` or API routes. Treat the README as the intended
spec, not as a description of what's deployed. Before building on a feature
the README mentions, check that its files actually exist.

- CI (`.github/workflows/ci.yml`): `npm install`, `npm run lint`,
  `npm run typecheck` on every push and PR. It's green on `main`.
- `.github/dependabot.yml` covers npm only, not github-actions.
- `.github/workflows/codeql.yml` scans TypeScript and the workflows.
- Open PRs: Dependabot #9 (react-dom), #10 (eslint 10), #11 (react),
  #12 (typescript 7), #13 (tailwindcss 4). All are major bumps and need
  checking against Next 16 before merging. Open issues: none.

## Before calling anything done

```
npm install
npm run lint
npm run typecheck
npm run build
```

There is no test script yet. Don't invent one silently; flag the gap in the PR.

## Rules

- Never fake a live integration. AI, Stripe and email must degrade
  explicitly (a clear "not configured" state) when their env vars are
  missing, as the README describes. Never fabricate data or benchmarks.
- Auth and role checks are server-side (`middleware.ts` plus per-route
  checks). Hiding UI is never the control.
- Never commit secrets. Keys belong in Vercel/env vars.
- Open a PR for every change; never push to `main`.

## Next steps

- Decide whether to restore the Build 1–4 code (find where it lives) or
  trim the README to match what's deployed.
- Add `github-actions` to `dependabot.yml`.
- Review the five major-version Dependabot PRs one at a time.

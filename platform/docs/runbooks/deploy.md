# Deploy runbook

**Flow:** PR → CI → Vercel preview → merge to `main` → run the **platform-migrations** workflow by hand (dry-run, then apply) on staging → verify staging → the same on production (environment approval) → Vercel production deploy.

> **Note (2026-10-10):** the workflows in `platform/.github/workflows/` (`ci`, `migrations`, `deploy`, `backup`, `security`) do **not** run. GitHub only runs workflows from the repository root's `.github/workflows/`. What actually runs: root `ci.yml` (including the `platform` job), `codeql.yml`, and `platform-migrations.yml` (manual). First-time staging steps: `docs/runbooks/staging-setup.md`.

1. Open a PR. Wait for all required checks. Review the Vercel preview (note: previews use the *staging* Supabase project).
2. Merge. Then GitHub → Actions → **platform-migrations** → staging: `dry-run`, check the list, then `apply`.
3. Only after verifying staging (sign-in, an RLS-sensitive page, admin settings read), run **platform-migrations** for `production` (a required reviewer approves the job).
4. Vercel deploys `main` to production. Smoke-check by hand: `/signin` answers with security headers, and `/dashboard` redirects a signed-out visitor (the `deploy-smoke` workflow under `platform/.github` does not run).
5. If the smoke job fails: run `docs/runbooks/rollback.md` immediately, then investigate.

Order matters: migrations must be backward compatible with the *previous* app version (expand → deploy → contract), because the DB migrates before the app switches.
Secrets: never in the repo. See `docs/secrets.md`.

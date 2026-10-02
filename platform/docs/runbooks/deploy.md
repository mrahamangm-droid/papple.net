# Deploy runbook

**Flow:** PR → CI (`ci`, `rls-tests`, `rls-coverage`, `security`) → Vercel preview → merge to `main` → staging migrations auto-apply → production migrations wait for approval → Vercel production deploy → `deploy-smoke` workflow.

1. Open a PR. Wait for all required checks. Review the Vercel preview (note: previews use the *staging* Supabase project).
2. Merge. The `migrations` workflow applies pending migrations to **staging**.
3. Approve the `production` environment gate in GitHub Actions only after verifying staging (sign-in, an RLS-sensitive page, admin settings read).
4. Vercel deploys `main` to production. `deploy-smoke` checks `/signin` headers and that `/dashboard` redirects anonymous users.
5. If the smoke job fails: run `docs/runbooks/rollback.md` immediately, then investigate.

Order matters: migrations must be backward compatible with the *previous* app version (expand → deploy → contract), because the DB migrates before the app switches.
Secrets: never in the repo. See `docs/secrets.md`.

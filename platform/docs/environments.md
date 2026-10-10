# Environments

| Env | App | Database | Purpose |
|---|---|---|---|
| dev | `pnpm -C apps/web dev` | local Supabase (`supabase start`) or `scripts/db-test.sh` (Postgres 16 + auth shim, tests only) | development |
| staging | Vercel preview/staging | separate Supabase project | PR verification; migrations applied with the manual **platform-migrations** workflow (see `runbooks/staging-setup.md`) |
| production | Vercel production (`main`) | production Supabase project | live; **platform-migrations** with environment `production` (required reviewer) |

Set `NEXT_PUBLIC_SITE_URL` in every environment (used for auth redirects; never derived from request headers). Staging and production must never share a database, R2 bucket or API keys.

Before real customers: upgrade Vercel off Hobby (commercial use is not permitted there) and Supabase off the free tier (free projects pause when idle; verify backup retention).

# Secrets reference (names and owners only — never values)

| Name | Where stored | Used by | Rotation |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env (public by design) | browser + server | on project change |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (server only) — bypasses RLS | `lib/supabase/service.ts` | 90 days / on exposure |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Vercel env; backup workflow uses GitHub Environment secrets | `lib/r2.ts`, backup | 90 days |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Vercel env (optional) | rate limiting | 90 days |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Vercel env (optional) | monitoring | on exposure |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Vercel env (optional) | consent-gated analytics | on exposure |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | GitHub Environments `staging` / `production` | migrations workflow | 90 days |
| `DATABASE_URL`, `BACKUP_PASSPHRASE` (+ R2 keys) | GitHub Environment `production` | nightly backup | 90 days; keep passphrase offline too |

Rules: secrets are entered by the owner directly into GitHub/Vercel/Supabase UIs; never pasted into chat, commits, issues or logs. `.env*` is git-ignored; `.env.example` lists names only. CI runs gitleaks on every PR.

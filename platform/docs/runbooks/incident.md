# Incident runbook

1. **Triage (first 15 min):** what is broken, since when (Sentry + Vercel + Supabase status), who is affected. Is data exposure possible? If yes treat as security incident (step 5).
2. **Contain:** flip the relevant feature flag off in Admin (`feature_flags`), or set `payments.enabled=false` to stop taking payments. No deploy needed.
3. **Fix or roll back:** `docs/runbooks/rollback.md`.
4. **Communicate:** status note to affected users; internal timeline in the incident doc.
5. **Security incident:** rotate exposed secrets (GitHub/Vercel/Supabase/Stripe/R2), review `audit_log`, preserve evidence, assess legal notification duties with counsel.
6. **After:** blameless review, add a regression test, update this runbook.

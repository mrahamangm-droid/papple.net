# Rollback runbook

**App (fast, safe):** Vercel → Deployments → pick the last good production deployment → *Promote to Production* (instant, no rebuild). Verify `/signin` and an authenticated flow.

**Database (careful):** migrations are forward-only.
1. Prefer a **new forward migration** that reverses the change (see undo notes in `supabase/migrations/README.md`). Review it like any migration.
2. Never run `DROP`/`TRUNCATE` without a reviewed backup (the migration workflow blocks them unless a line is marked `-- allow-destructive`).
3. Last resort: Supabase point-in-time recovery or restore from the nightly R2 dump (`docs/runbooks/restore.md`). This loses data written after the restore point; get owner approval first.

**Config/pricing mistakes:** no deploy needed. An admin reverts the value; `settings_history` shows the previous value, `audit_log` shows who changed it.

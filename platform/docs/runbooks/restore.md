# Backup and restore runbook

**Backups:** (1) Supabase automated backups / PITR (verify the retention of the active plan before launch); (2) nightly encrypted `pg_dump` to Cloudflare R2 via the `backup` workflow (GPG AES256, passphrase in `BACKUP_PASSPHRASE`).

**Restore drill (run once before launch, then quarterly):**
1. Download the latest object under `papple/` from the R2 bucket; decrypt: `gpg --decrypt dump.sql.gpg > dump.sql`.
2. Create a scratch Postgres (never production): `createdb restore_test && psql restore_test -f dump.sql`.
3. Verify: row counts for `organizations`, `memberships`, `plans`, `audit_log`; run `scripts/check-rls-coverage.sql` (must return no rows).
4. Record date, dump age, duration and result below.

| Date | Dump age | Duration | Result | By |
|---|---|---|---|---|
| _not yet rehearsed — NOT VERIFIED_ | | | | |

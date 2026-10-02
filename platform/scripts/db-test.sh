#!/usr/bin/env bash
# Runs migrations + pgTAP tests on a throwaway local Postgres 16 with a Supabase auth shim.
# CI uses the real Supabase CLI (`supabase test db`); this is the no-Docker fallback.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=/usr/lib/postgresql/16/bin; D=${PGDATA_DIR:-/tmp/papple-pg}; PORT=54329
if [ ! -d "$D" ]; then install -d -o postgres "$D"; su postgres -c "$PGBIN/initdb -D $D -A trust >/dev/null"; fi
su postgres -c "$PGBIN/pg_ctl -D $D -o '-p $PORT -k /tmp' -l /tmp/papple-pg.log -w start >/dev/null" || true
export PGHOST=/tmp PGPORT=$PORT PGUSER=postgres
psql -qAt -c "drop database if exists papple_test" -c "create database papple_test" >/dev/null
export PGDATABASE=papple_test
psql -q -v ON_ERROR_STOP=1 -f scripts/local-shim.sql >/dev/null
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
[ -f supabase/seed.sql ] && psql -q -v ON_ERROR_STOP=1 -f supabase/seed.sql >/dev/null
cov=$(psql -qAt -f scripts/check-rls-coverage.sql); if [ -n "$cov" ]; then echo "RLS COVERAGE FAILED:"; echo "$cov"; exit 1; fi; echo "RLS coverage OK"
out=$(mktemp)
for t in supabase/tests/*.test.sql; do echo "== $t"; psql -q -v ON_ERROR_STOP=0 -f "$t" 2>&1 | tee -a "$out"; done
if grep -qE "^\s*not ok|Looks like you failed|ERROR:" "$out"; then echo "DB TESTS FAILED"; exit 1; fi
echo "DB TESTS PASSED: $(grep -cE "^\s*ok" "$out") assertions"

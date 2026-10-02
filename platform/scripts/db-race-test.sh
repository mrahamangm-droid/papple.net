#!/usr/bin/env bash
# Concurrency checks pgTAP cannot do (it runs in one transaction). Builds on scripts/db-test.sh's papple_test DB
# (run that first), clones it, fires parallel calls and asserts that limits and de-duplication hold.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp PGPORT=54329 PGUSER=postgres
psql -qAt -c "drop database if exists papple_race" -c "create database papple_race template papple_test" >/dev/null || { echo "run scripts/db-test.sh first"; exit 2; }
export PGDATABASE=papple_race
fail=0
q() { psql -qAt -c "$1"; }
as() { # as <user-uuid> <sql>  (separate session, authenticated role, committed)
  psql -q -c "set role authenticated" -c "select set_config('request.jwt.claim.sub','$1',false)" -c "select pg_advisory_lock_shared(999)" -c "$2" >/dev/null 2>>/tmp/race-errors.log
}
# Barrier: a holder keeps advisory lock 999 so every worker blocks at the same point, then they all start together.
hold() { psql -qAt -c "select pg_advisory_lock(999)" -c "select pg_sleep(1.5)" >/dev/null 2>&1 & sleep 0.4; }
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected $3, got $2)"; fail=1; fi; }

U_CLIENT=aaaaaa99-0000-0000-0000-000000000001; U_PRO=aaaaaa99-0000-0000-0000-000000000002; U_PRO2=aaaaaa99-0000-0000-0000-000000000003
O_CLIENT=cccccc99-0000-0000-0000-00000000000c; O_PRO=cccccc99-0000-0000-0000-00000000000a; O_PRO2=cccccc99-0000-0000-0000-00000000000b
q "insert into auth.users (id,email) values ('$U_CLIENT','c@r.test'),('$U_PRO','p@r.test'),('$U_PRO2','q@r.test');
   insert into organizations (id,type,name) values ('$O_CLIENT','client_company','Race Client'),('$O_PRO','agency','Race Pro'),('$O_PRO2','agency','Race Pro 2');
   insert into memberships (user_id,org_id,role) values ('$U_CLIENT','$O_CLIENT','owner'),('$U_PRO','$O_PRO','owner'),('$U_PRO2','$O_PRO2','owner');
   insert into provider_profiles (id,org_id,slug,headline) values ('dddddd99-0000-0000-0000-000000000001','$O_PRO','race-pro','Race pro headline'),('dddddd99-0000-0000-0000-000000000002','$O_PRO2','race-pro-2','Race pro 2 headline');
   insert into projects (id,org_id,title,description,currency,status)
     select ('eeeeee99-0000-0000-0000-0000000000' || lpad(g::text,2,'0'))::uuid,'$O_CLIENT','Race project '||g,'Detailed description','USD','open' from generate_series(1,8) g;
   insert into services (id,org_id,slug,title,status) values ('dddddd99-0000-0000-0000-0000000000a1','$O_PRO','race-svc','Race service','published');
   insert into platform_settings (key,value,description) values
     ('limits.proposals_per_month','{\"default\":1}','race'),('limits.max_services','{\"default\":1}','race'),('limits.max_portfolio_items','{\"default\":1}','race')
   on conflict (key) do update set value = excluded.value;"

# 1. monthly proposal limit across different projects
hold; for p in 1 2 3 4 5 6 7 8; do as $U_PRO "select submit_proposal('$O_PRO','eeeeee99-0000-0000-0000-0000000000$(printf %02d $p)','hello',1000,'USD',7)" & done; wait
check "monthly proposal limit holds under parallel submits" "$(q "select count(*) from proposals where org_id='$O_PRO'")" 1

# 2. service publish limit
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "select upsert_service('$O_PRO2',null,null,'Race svc $n','d','fixed',100,'USD',3,'published')" & done; wait
check "published-service limit holds under parallel upserts" "$(q "select count(*) from services where org_id='$O_PRO2' and status='published'")" 1

# 3. portfolio limit
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "insert into portfolio_items (profile_id,org_id,title) values ('dddddd99-0000-0000-0000-000000000002','$O_PRO2','item $n')" & done; wait
check "portfolio limit holds under parallel inserts" "$(q "select count(*) from portfolio_items where org_id='$O_PRO2'")" 1

# 4. conversation de-duplication: same service, same pair, parallel
q "update platform_settings set value='100' where key='limits.new_conversations_per_day'" 2>/dev/null || q "insert into platform_settings (key,value,description) values ('limits.new_conversations_per_day','100','race')"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_CLIENT "select start_conversation('$O_CLIENT','service','dddddd99-0000-0000-0000-0000000000a1','hello $n')" & done; wait
check "one conversation per (kind, ref, org pair) under parallel starts" "$(q "select count(*) from conversations where ref_id='dddddd99-0000-0000-0000-0000000000a1'")" 1

# 5. daily conversation cap across different refs
q "update platform_settings set value='1' where key='limits.new_conversations_per_day'; delete from conversations where created_by='$U_PRO';"
hold; for p in 1 2 3 4 5 6 7 8; do as $U_PRO "select start_conversation('$O_PRO','project','eeeeee99-0000-0000-0000-0000000000$(printf %02d $p)','hi $p')" & done; wait
check "daily conversation cap holds under parallel starts" "$(q "select count(*) from conversations where created_by='$U_PRO'")" 1

psql -qAt -d postgres -c "drop database if exists papple_race" >/dev/null
[ $fail -eq 0 ] && echo "RACE TESTS PASSED" || { echo "RACE TESTS FAILED"; exit 1; }

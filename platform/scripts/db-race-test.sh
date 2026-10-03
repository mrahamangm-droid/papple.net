#!/usr/bin/env bash
# Concurrency checks pgTAP cannot do (it runs in one transaction). Builds on scripts/db-test.sh's papple_test DB
# (run that first), clones it, fires parallel calls and asserts that limits and de-duplication hold.
set -uo pipefail
cd "$(dirname "$0")/.."
export PGHOST=/tmp PGPORT=54329 PGUSER=postgres
psql -qAt -c "drop database if exists papple_race" -c "create database papple_race template papple_test" >/dev/null || { echo "run scripts/db-test.sh first"; exit 2; }
export PGDATABASE=papple_race
fail=0
: > /tmp/race-errors.log
q() { psql -qAt -c "$1"; }
as() { # as <user-uuid> <sql>  (separate session, authenticated role, committed)
  psql -q -c "set role authenticated" -c "select set_config('request.jwt.claim.sub','$1',false)" -c "select pg_advisory_lock_shared(999)" -c "$2" >/dev/null 2>>/tmp/race-errors.log
}
svc() { # svc <sql>  (separate session, service_role, committed) for webhook-style calls
  psql -q -c "set role service_role" -c "select pg_advisory_lock_shared(999)" -c "$1" >/dev/null 2>>/tmp/race-errors.log
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

# 6. one hire per project even when different proposals are hired at once
q "insert into organizations (id,type,name) select ('cccccc99-0000-0000-0000-0000000001' || lpad(g::text,2,'0'))::uuid,'agency','Hire Pro '||g from generate_series(1,4) g;
   insert into projects (id,org_id,title,description,currency,status) values ('eeeeee99-0000-0000-0000-0000000000f1','$O_CLIENT','Hire race','Detailed description','USD','open');
   insert into proposals (id,project_id,org_id,cover_letter,price,currency,delivery_days,status)
     select ('ffffff99-0000-0000-0000-0000000000' || lpad(g::text,2,'0'))::uuid,'eeeeee99-0000-0000-0000-0000000000f1',('cccccc99-0000-0000-0000-0000000001' || lpad(g::text,2,'0'))::uuid,'Offer',1000,'USD',7,'shortlisted' from generate_series(1,4) g;"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_CLIENT "select create_contract('$O_CLIENT','ffffff99-0000-0000-0000-0000000000$(printf %02d $(( (n % 4) + 1 )))')" & done; wait
check "exactly one contract per project under parallel hires" "$(q "select count(*) from contracts where project_id='eeeeee99-0000-0000-0000-0000000000f1' and status <> 'cancelled'")" 1
check "exactly one proposal ends up hired" "$(q "select count(*) from proposals where project_id='eeeeee99-0000-0000-0000-0000000000f1' and status='hired'")" 1

# 7. approving one milestone from many tabs creates one payment
q "insert into projects (id,org_id,title,description,currency,status) values ('eeeeee99-0000-0000-0000-0000000000f2','$O_CLIENT','Pay race','Detailed description','USD','closed');
   insert into proposals (id,project_id,org_id,cover_letter,price,currency,delivery_days,status) values ('ffffff99-0000-0000-0000-0000000000f2','eeeeee99-0000-0000-0000-0000000000f2','$O_PRO','Offer',40000,'USD',7,'hired');
   insert into connected_accounts (org_id,stripe_account_id,payouts_enabled) values ('$O_PRO','acct_race',true);
   insert into contracts (id,project_id,proposal_id,client_org_id,provider_org_id,title,price,currency,commission_pro_bps,commission_client_bps,status,accepted_by_client,accepted_by_provider)
     values ('dddddd99-0000-0000-0000-0000000000c2','eeeeee99-0000-0000-0000-0000000000f2','ffffff99-0000-0000-0000-0000000000f2','$O_CLIENT','$O_PRO','Pay race',40000,'USD',500,200,'active',true,true);
   insert into milestones (id,contract_id,position,title,amount,status) values ('99999999-0000-0000-0000-0000000000a1','dddddd99-0000-0000-0000-0000000000c2',1,'Only',40000,'submitted');"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_CLIENT "select approve_milestone('$O_CLIENT','99999999-0000-0000-0000-0000000000a1')" & done; wait
check "one payment row per milestone under parallel approvals" "$(q "select count(*) from payments where milestone_id='99999999-0000-0000-0000-0000000000a1'")" 1
check "no approval call failed" "$(grep -c approve_milestone /tmp/race-errors.log 2>/dev/null || true)" 0

# 8. a payment reported by many webhook deliveries is recorded once; the rest are flagged, never double-applied
PAY=$(q "select id from payments where milestone_id='99999999-0000-0000-0000-0000000000a1'")
hold; for n in 1 2 3 4 5 6 7 8; do svc "select record_payment_succeeded('$PAY','cs_$n','pi_$n',40800,'USD')" & done; wait
check "payment succeeded exactly once" "$(q "select count(*) from payments where id='$PAY' and status='succeeded'")" 1
check "the other seven deliveries are flagged as duplicate charges" "$(q "select count(*) from audit_log where action='payment.duplicate_charge'")" 7
check "the provider is notified once" "$(q "select count(*) from notifications where type='payment_received'")" 1
check "the contract completes once" "$(q "select count(*) from notifications where type='contract_completed' and user_id='$U_PRO'")" 1

# 9. the AI allowance holds under parallel reservations (monthly limit 3, eight callers at once)
q "update feature_flags set enabled=true where key='ai.assistant'; update platform_settings set value='{\"default\":3}' where key='ai.monthly_message_limits'; update platform_settings set value='null'::jsonb where key='ai.daily_request_cap';"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO "select ai_reserve('$O_PRO','proposal_draft')" & done; wait
check "the monthly AI allowance holds under parallel reservations" "$(q "select count(*) from ai_usage where org_id='$O_PRO'")" 3

# 10. parallel subscription webhooks for one organization end on the newest event, and one subscription id never lands on two organizations
q "update plans set stripe_price_id='price_race' where key='business'"
hold; for n in 1 2 3 4 5 6 7 8; do svc "select apply_subscription_event('$O_PRO','cus_r','sub_r','price_race','active',now() + interval '30 days',false,'2026-10-01T00:00:0$n+00')" & done; wait
check "the newest subscription event wins under parallel deliveries" "$(q "select event_at = '2026-10-01T00:00:08+00' from subscriptions where org_id='$O_PRO'")" t
hold; for n in 1 2 3 4; do svc "select apply_subscription_event('$O_PRO2','cus_x','sub_r','price_race','active',null,false,'2026-10-02T00:00:0$n+00')" & done; wait
check "a subscription id belongs to one organization only" "$(q "select count(distinct org_id) from subscriptions where stripe_subscription_id='sub_r'")" 1

# 11. issuing the same invoice from many tabs creates one invoice with one number
q "insert into billing_profiles (org_id, legal_name, address, country, tax_number, tax_bps) values ('$O_PRO','Race Pro LLC','Office 1, Dubai','AE','TRN-1',500)"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO "select issue_invoice('$O_PRO','99999999-0000-0000-0000-0000000000a1')" & done; wait
check "one invoice per milestone under parallel issuing" "$(q "select count(*) from invoices where org_id='$O_PRO'")" 1
check "the first invoice number is 000001" "$(q "select right(number,6) from invoices where org_id='$O_PRO'")" 000001

psql -qAt -d postgres -c "drop database if exists papple_race" >/dev/null
[ $fail -eq 0 ] && echo "RACE TESTS PASSED" || { echo "RACE TESTS FAILED"; exit 1; }

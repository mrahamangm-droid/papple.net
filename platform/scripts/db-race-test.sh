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

# 12. the CRM contact limit holds under parallel creates, and a duplicate email is stored once
q "update platform_settings set value='{\"default\":3}' where key='limits.crm_contacts'"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "select crm_save_contact('$O_PRO2',null,'Race $n',null,'race$n@x.test',null,'manual')" & done; wait
check "the CRM contact limit holds under parallel creates" "$(q "select count(*) from crm_contacts where org_id='$O_PRO2'")" 3
q "update platform_settings set value='{\"default\":100}' where key='limits.crm_contacts'"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "select crm_save_contact('$O_PRO2',null,'Same','x','same@x.test',null,'manual')" & done; wait
check "a duplicate email is stored once under parallel creates" "$(q "select count(*) from crm_contacts where org_id='$O_PRO2' and lower(email)='same@x.test'")" 1

# 13. the CRM daily email cap holds under parallel sends
q "update feature_flags set enabled=true where key='crm.email'; update platform_settings set value='{\"default\":3}' where key='limits.crm_emails_per_day'; insert into billing_profiles (org_id, legal_name, address, country) values ('$O_PRO2','Race Two LLC','Office 2, Dubai','AE'); update crm_contacts set basis='opted_in' where org_id='$O_PRO2' and lower(email)='same@x.test'"
CID=$(q "select id from crm_contacts where org_id='$O_PRO2' and lower(email)='same@x.test'")
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "select crm_reserve_email('$O_PRO2','$CID','Race $n','Body')" & done; wait
check "the daily email cap holds under parallel sends" "$(q "select count(*) from crm_emails where org_id='$O_PRO2'")" 3

# 14. the team seat limit holds under parallel invites and under parallel accepts
q "update platform_settings set value='{\"default\":4}' where key='limits.team_seats'"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO2 "select team_create_invite('$O_PRO2','t$n@r.test','member','$(printf '%064d' $n)')" & done; wait
check "members plus pending invites stay within the seat limit under parallel invites" "$(q "select count(*) from org_invites where org_id='$O_PRO2' and accepted_at is null and revoked_at is null")" 3
q "insert into auth.users (id,email) select ('aaaaaa99-0000-0000-0000-0000000001' || lpad(g::text,2,'0'))::uuid, email from (select email, row_number() over (order by email) g from org_invites where org_id='$O_PRO2') x; update platform_settings set value='{\"default\":2}' where key='limits.team_seats'"
hold; for n in 1 2 3; do h=$(q "select token_hash from org_invites where org_id='$O_PRO2' order by email offset $((n-1)) limit 1"); as aaaaaa99-0000-0000-0000-0000000001$(printf %02d $n) "select team_accept_invite('$h')" & done; wait
check "parallel accepts never exceed the seat limit" "$(q "select count(*) from memberships where org_id='$O_PRO2'")" 2

# 15. two owners cannot leave an organization without an owner or without members by acting at the same time
O_T=cccccc99-0000-0000-0000-0000000000a1; U_T1=aaaaaa99-0000-0000-0000-0000000002a1; U_T2=aaaaaa99-0000-0000-0000-0000000002a2
q "insert into auth.users (id,email) values ('$U_T1','o1@r.test'),('$U_T2','o2@r.test'); insert into organizations (id,type,name) values ('$O_T','agency','Race Team'); insert into memberships (user_id,org_id,role) values ('$U_T1','$O_T','owner'),('$U_T2','$O_T','owner')"
hold; as $U_T1 "select team_set_role('$O_T','$U_T1','member')" & as $U_T2 "select team_set_role('$O_T','$U_T2','member')" & wait
check "two owners stepping down together leave one owner" "$(q "select count(*) from memberships where org_id='$O_T' and role='owner'")" 1
q "update memberships set role='owner' where org_id='$O_T'"
hold; as $U_T1 "select team_remove_member('$O_T','$U_T2')" & as $U_T2 "select team_remove_member('$O_T','$U_T1')" & wait
check "two owners removing each other leave one member" "$(q "select count(*) from memberships where org_id='$O_T'")" 1
q "insert into memberships (user_id,org_id,role) select u,'$O_T','owner' from (select '$U_T1'::uuid u union select '$U_T2'::uuid) x on conflict (user_id,org_id) do update set role='owner'"
hold; as $U_T1 "select team_leave('$O_T')" & as $U_T2 "select team_leave('$O_T')" & wait
check "two owners leaving together leave one member" "$(q "select count(*) from memberships where org_id='$O_T'")" 1

# 16. the credential limit holds under parallel saves
q "update platform_settings set value='{\"default\":3}' where key='limits.credentials'"
hold; for n in 1 2 3 4 5 6 7 8; do as $U_PRO "select credential_save('$O_PRO',null,'award','Race award $n','Race body',null,null,null,null)" & done; wait
check "the credential limit holds under parallel saves" "$(q "select count(*) from provider_credentials where org_id='$O_PRO'")" 3

# 17. the pool member limit holds under parallel adds
q "insert into projects (id,org_id,title,description,currency,status) values ('eeeeee99-0000-0000-0000-0000000000f9','$O_CLIENT','Invite race','Detailed description','USD','open'); insert into talent_pools (id,org_id,name) values ('99999999-0000-0000-0000-0000000000b1','$O_CLIENT','Race pool'); update platform_settings set value='{\"default\":1}' where key='limits.pool_members'"
hold; for n in 1 2 3 4; do as $U_CLIENT "select pool_set_member('$O_CLIENT','99999999-0000-0000-0000-0000000000b1','dddddd99-0000-0000-0000-00000000000$(( (n % 2) + 1 ))',null,'{}')" & done; wait
check "the pool member limit holds under parallel adds" "$(q "select count(*) from talent_pool_members where pool_id='99999999-0000-0000-0000-0000000000b1'")" 1

# 18. the daily invitation cap holds under parallel invites (different professionals)
q "delete from talent_pool_members; insert into talent_pool_members (pool_id,profile_id,org_id) values ('99999999-0000-0000-0000-0000000000b1','dddddd99-0000-0000-0000-000000000001','$O_CLIENT'),('99999999-0000-0000-0000-0000000000b1','dddddd99-0000-0000-0000-000000000002','$O_CLIENT'); update platform_settings set value='{\"default\":1}' where key='limits.project_invites_per_day'"
hold; for n in 1 2 3 4; do as $U_CLIENT "select project_invite('$O_CLIENT','eeeeee99-0000-0000-0000-0000000000f9','dddddd99-0000-0000-0000-00000000000$(( (n % 2) + 1 ))','Please send a proposal')" & done; wait
check "the daily invitation cap holds under parallel invites" "$(q "select count(*) from project_invitations where org_id='$O_CLIENT'")" 1

# 19. one invitation per project and professional under parallel sends
q "delete from project_invitations; update platform_settings set value='null' where key='limits.project_invites_per_day'"
hold; for n in 1 2 3 4 5 6; do as $U_CLIENT "select project_invite('$O_CLIENT','eeeeee99-0000-0000-0000-0000000000f9','dddddd99-0000-0000-0000-000000000001','Please send a proposal')" & done; wait
check "parallel sends make one invitation" "$(q "select count(*) from project_invitations where org_id='$O_CLIENT'")" 1

# 20. the API key limit holds under parallel creates
q "update platform_settings set value='{\"default\":2}' where key='limits.api_keys'"
hold; for n in 1 2 3 4 5 6; do as $U_CLIENT "select api_key_create('$O_CLIENT','Race key $n','racekey$n',repeat('$n',64))" & done; wait
check "the API key limit holds under parallel creates" "$(q "select count(*) from api_keys where org_id='$O_CLIENT' and revoked_at is null")" 2

# 21. the task and file limits hold under parallel creates
q "update platform_settings set value='{\"default\":2}' where key in ('limits.tasks_per_contract','limits.files_per_contract')"
hold; for n in 1 2 3 4 5 6; do as $U_CLIENT "select task_save('$O_CLIENT','dddddd99-0000-0000-0000-0000000000c2',null,'Race task $n','','normal',null,null,null,'private')" & done; wait
check "the task limit holds under parallel creates" "$(q "select count(*) from tasks where org_id='$O_CLIENT'")" 2
hold; for n in 1 2 3 4 5 6; do as $U_CLIENT "select file_register('$O_CLIENT','dddddd99-0000-0000-0000-0000000000c2','eeeeee99-0000-0000-0000-0000000002f$n','race$n.pdf','application/pdf',100,'orgs/$O_CLIENT/eeeeee99-0000-0000-0000-0000000002f$n.pdf','private')" & done; wait
check "the file limit holds under parallel registers" "$(q "select count(*) from contract_files where org_id='$O_CLIENT'")" 2

# 22. parallel admin accepts above the approval threshold create one spend request
U_SO=aaaaaa99-0000-0000-0000-0000000005a1; U_SA1=aaaaaa99-0000-0000-0000-0000000005a2; U_SA2=aaaaaa99-0000-0000-0000-0000000005a3
O_SC=cccccc99-0000-0000-0000-0000000005c1
q "insert into auth.users (id,email) values ('$U_SO','so@r.test'),('$U_SA1','sa1@r.test'),('$U_SA2','sa2@r.test');
   insert into organizations (id,type,name) values ('$O_SC','client_company','Spend Client');
   insert into memberships (user_id,org_id,role) values ('$U_SO','$O_SC','owner'),('$U_SA1','$O_SC','admin'),('$U_SA2','$O_SC','admin');
   insert into projects (id,org_id,title,description,currency,status) values ('eeeeee99-0000-0000-0000-0000000005e1','$O_SC','Spend project','Detailed description','USD','open');
   insert into proposals (id,project_id,org_id,cover_letter,price,currency,delivery_days,status) values ('ffffff99-0000-0000-0000-0000000005f1','eeeeee99-0000-0000-0000-0000000005e1','$O_PRO','Offer',50000,'USD',10,'shortlisted');
   insert into contracts (id,project_id,proposal_id,client_org_id,provider_org_id,title,price,currency,commission_pro_bps,commission_client_bps)
     values ('dddddd99-0000-0000-0000-0000000005d1','eeeeee99-0000-0000-0000-0000000005e1','ffffff99-0000-0000-0000-0000000005f1','$O_SC','$O_PRO','Spend contract',50000,'USD',500,200);
   insert into milestones (contract_id,position,title,amount) values ('dddddd99-0000-0000-0000-0000000005d1',1,'All',50000);
   insert into spend_policies (org_id,enabled,threshold_minor,currency) values ('$O_SC',true,1000,'USD');"
hold; for n in 1 2 3 4 5 6; do as $([ $((n % 2)) -eq 0 ] && echo $U_SA1 || echo $U_SA2) "select accept_contract('$O_SC','dddddd99-0000-0000-0000-0000000005d1')" & done; wait
check "one pending spend request under parallel accepts" "$(q "select count(*) from spend_requests where org_id='$O_SC' and status='pending'")" 1
check "and the contract is still not accepted" "$(q "select accepted_by_client from contracts where id='dddddd99-0000-0000-0000-0000000005d1'")" f

# 23. an owner approving while an admin re-accepts changed terms never deadlocks (both lock the contract first)
q "update spend_policies set threshold_minor = 1000 where org_id = '$O_SC'"
for i in 1 2 3 4 5 6 7 8 9 10; do
  q "update spend_requests set status = 'withdrawn' where org_id = '$O_SC' and status = 'pending'; update contracts set accepted_by_client = false where id = 'dddddd99-0000-0000-0000-0000000005d1'"
  as $U_SA1 "select accept_contract('$O_SC','dddddd99-0000-0000-0000-0000000005d1')"
  q "update milestones set title = 'All $i' where contract_id = 'dddddd99-0000-0000-0000-0000000005d1'"
  hold
  as $U_SO "select spend_request_decide('$O_SC', (select id from spend_requests where org_id = '$O_SC' and status = 'pending'), true, '')" &
  as $U_SA2 "select accept_contract('$O_SC','dddddd99-0000-0000-0000-0000000005d1')" &
  wait
done
check "no deadlock between approve and re-accept" "$(grep -c 'deadlock detected' /tmp/race-errors.log)" 0

# 24. six clients grabbing the same booking slot at once get exactly one booking
U_BP=aaaaaa99-0000-0000-0000-0000000006a0; O_BP=cccccc99-0000-0000-0000-0000000006c0
q "insert into auth.users (id,email) values ('$U_BP','bp@r.test'); insert into organizations (id,type,name) values ('$O_BP','agency','Booking Pro');
   insert into memberships (user_id,org_id,role) values ('$U_BP','$O_BP','owner');
   insert into provider_profiles (org_id,slug,headline) values ('$O_BP','race-booking-pro','Race booking pro');
   insert into services (id,org_id,slug,title,status,booking_minutes) values ('dddddd99-0000-0000-0000-0000000006d0','$O_BP','race-booking','Race booking','published',30);
   insert into booking_settings (org_id,enabled,timezone,buffer_minutes,min_notice_hours,horizon_days) values ('$O_BP',true,'UTC',0,0,90);
   insert into booking_hours (org_id,weekday,start_time,end_time) select '$O_BP', g, '09:00', '17:00' from generate_series(1,7) g;"
for n in 1 2 3 4 5 6; do
  q "insert into auth.users (id,email) values ('aaaaaa99-0000-0000-0000-0000000006b$n','bc$n@r.test'); insert into organizations (id,type,name) values ('cccccc99-0000-0000-0000-0000000006e$n','client_company','Booking Client $n');
     insert into memberships (user_id,org_id,role) values ('aaaaaa99-0000-0000-0000-0000000006b$n','cccccc99-0000-0000-0000-0000000006e$n','owner')"
done
SLOT=$(q "select ((current_date + 10) + time '10:00') at time zone 'UTC'")
hold; for n in 1 2 3 4 5 6; do as aaaaaa99-0000-0000-0000-0000000006b$n "select booking_request('cccccc99-0000-0000-0000-0000000006e$n','dddddd99-0000-0000-0000-0000000006d0','$SLOT','race')" & done; wait
check "one booking under six parallel requests for the same slot" "$(q "select count(*) from bookings where provider_org_id='$O_BP'")" 1

# 25. paying one booking from six tabs creates one payment row; six webhook deliveries record it once
B_PAY=$(q "insert into bookings (provider_org_id,client_org_id,service_id,starts_at,ends_at,blocked,status,price,currency,commission_pro_bps,commission_client_bps,confirmed_at,pay_by)
           values ('$O_BP','cccccc99-0000-0000-0000-0000000006e1','dddddd99-0000-0000-0000-0000000006d0',(current_date + 11) + time '10:00',(current_date + 11) + time '10:30',
                   tstzrange((current_date + 11) + time '10:00',(current_date + 11) + time '10:30'),'confirmed',5000,'USD',500,200,now(),now() + interval '1 day') returning id")
hold; for n in 1 2 3 4 5 6; do as aaaaaa99-0000-0000-0000-0000000006b1 "select booking_pay('cccccc99-0000-0000-0000-0000000006e1','$B_PAY')" & done; wait
check "one payment row under six parallel pay calls" "$(q "select count(*) from booking_payments where booking_id='$B_PAY'")" 1
P_PAY=$(q "select id from booking_payments where booking_id='$B_PAY'")
hold; for n in 1 2 3 4 5 6; do svc "select record_payment_succeeded('$P_PAY','cs_r','pi_r',5100,'USD')" & done; wait
check "a booking payment is recorded once under parallel webhooks" "$(q "select count(*) from audit_log where action='booking.paid' and entity_id='$B_PAY'")" 1
check "and ends paid" "$(q "select status from booking_payments where id='$P_PAY'")" succeeded

# 26. a webhook recording a payment just before the deadline, still committing after it, is not undone by a release that
#     waited on the booking row (the release re-checks after the lock instead of trusting its first snapshot)
B_LATE=$(q "insert into bookings (provider_org_id,client_org_id,service_id,starts_at,ends_at,blocked,status,price,currency,commission_pro_bps,commission_client_bps,confirmed_at,pay_by)
            values ('$O_BP','cccccc99-0000-0000-0000-0000000006e2','dddddd99-0000-0000-0000-0000000006d0',(current_date + 12) + time '10:00',(current_date + 12) + time '10:30',
                    tstzrange((current_date + 12) + time '10:00',(current_date + 12) + time '10:30'),'confirmed',5000,'USD',500,200,now(),now() + interval '3 seconds') returning id")
P_LATE=$(q "insert into booking_payments (booking_id,amount,client_fee,provider_fee,client_total,application_fee,currency) values ('$B_LATE',5000,100,250,5100,350,'USD') returning id")
psql -q -c "begin" -c "set local role service_role" -c "select record_payment_succeeded('$P_LATE','cs_late','pi_late',5100,'USD')" -c "select pg_sleep(5)" -c "commit" >/dev/null 2>>/tmp/race-errors.log &
sleep 4
psql -q -c "set role authenticated" -c "select set_config('request.jwt.claim.sub','aaaaaa99-0000-0000-0000-0000000006b2',false)" \
  -c "select count(*) from booking_list('cccccc99-0000-0000-0000-0000000006e2')" >/dev/null 2>>/tmp/race-errors.log
wait
check "a payment committed while a release waited keeps the booking" "$(q "select b.status || ' ' || p.status from bookings b join booking_payments p on p.booking_id = b.id where b.id='$B_LATE'")" "confirmed succeeded"

psql -qAt -d postgres -c "drop database if exists papple_race" >/dev/null
[ $fail -eq 0 ] && echo "RACE TESTS PASSED" || { echo "RACE TESTS FAILED"; exit 1; }

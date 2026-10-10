begin;
select plan(85);
create function extensions.t_rows_affected(q text) returns int language plpgsql as
$$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;

insert into auth.users (id, email) values
 ('aaaaaa41-0000-0000-0000-0000000000a1','owner@x.test'),('aaaaaa41-0000-0000-0000-0000000000a2','owner2@x.test'),('aaaaaa41-0000-0000-0000-0000000000a3','admin@x.test'),('aaaaaa41-0000-0000-0000-0000000000a4','admin2@x.test'),
 ('aaaaaa41-0000-0000-0000-0000000000a5','member@x.test'),('aaaaaa41-0000-0000-0000-0000000000a6','prov@x.test'),('aaaaaa41-0000-0000-0000-0000000000a7','stranger@x.test');
insert into organizations (id, type, name) values ('cccccc41-0000-0000-0000-0000000000c1','client_company','Client Co'),('cccccc41-0000-0000-0000-0000000000b1','agency','Provider Co');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa41-0000-0000-0000-0000000000a1','cccccc41-0000-0000-0000-0000000000c1','owner'),('aaaaaa41-0000-0000-0000-0000000000a2','cccccc41-0000-0000-0000-0000000000c1','owner'),('aaaaaa41-0000-0000-0000-0000000000a3','cccccc41-0000-0000-0000-0000000000c1','admin'),('aaaaaa41-0000-0000-0000-0000000000a4','cccccc41-0000-0000-0000-0000000000c1','admin'),('aaaaaa41-0000-0000-0000-0000000000a5','cccccc41-0000-0000-0000-0000000000c1','member'),('aaaaaa41-0000-0000-0000-0000000000a6','cccccc41-0000-0000-0000-0000000000b1','owner');
insert into projects (id, org_id, title, description, currency, status, visibility)
 select ('eeeeee41-0000-0000-0000-00000000000' || g)::uuid, 'cccccc41-0000-0000-0000-0000000000c1', 'Project ' || g, 'Detailed description', 'USD', 'open', 'public' from generate_series(1,3) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff41-0000-0000-0000-000000000001','eeeeee41-0000-0000-0000-000000000001','cccccc41-0000-0000-0000-0000000000b1','Offer',50000,'USD',10,'shortlisted'),
 ('ffffff41-0000-0000-0000-000000000002','eeeeee41-0000-0000-0000-000000000002','cccccc41-0000-0000-0000-0000000000b1','Offer',5000,'USD',10,'shortlisted'),
 ('ffffff41-0000-0000-0000-000000000003','eeeeee41-0000-0000-0000-000000000003','cccccc41-0000-0000-0000-0000000000b1','Offer',50000,'USD',10,'shortlisted');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps) values
 ('dddddd41-0000-0000-0000-000000000001','eeeeee41-0000-0000-0000-000000000001','ffffff41-0000-0000-0000-000000000001','cccccc41-0000-0000-0000-0000000000c1','cccccc41-0000-0000-0000-0000000000b1','K1',50000,'USD',500,200),
 ('dddddd41-0000-0000-0000-000000000002','eeeeee41-0000-0000-0000-000000000002','ffffff41-0000-0000-0000-000000000002','cccccc41-0000-0000-0000-0000000000c1','cccccc41-0000-0000-0000-0000000000b1','K2',5000,'USD',500,200),
 ('dddddd41-0000-0000-0000-000000000003','eeeeee41-0000-0000-0000-000000000003','ffffff41-0000-0000-0000-000000000003','cccccc41-0000-0000-0000-0000000000c1','cccccc41-0000-0000-0000-0000000000b1','K3',50000,'USD',500,200);
insert into milestones (contract_id, position, title, amount) values
 ('dddddd41-0000-0000-0000-000000000001',1,'First',30000),('dddddd41-0000-0000-0000-000000000001',2,'Second',20000),('dddddd41-0000-0000-0000-000000000002',1,'Only',5000),('dddddd41-0000-0000-0000-000000000003',1,'Only',50000);

set local role authenticated;

-- 1. policy: only owners set it, values are validated, the provider never reads it
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, '42501', null, 'an admin cannot set the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a5',true);
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, '42501', null, 'a member cannot set the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, '42501', null, 'another organization cannot set the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a7',true);
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, '42501', null, 'a stranger cannot set the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, -1, 'USD')$$, '22023', null, 'a negative threshold is refused');
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'usd')$$, '22023', null, 'a lowercase currency is refused');
select throws_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'US')$$, '22023', null, 'a short currency is refused');
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000002'), 'accepted', 'an owner accepts directly');
-- policy off: an admin accepts as before
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'accepted', 'without a policy an admin accepts directly');
reset role; update contracts set accepted_by_client = false where id in ('dddddd41-0000-0000-0000-000000000001','dddddd41-0000-0000-0000-000000000002'); set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, 'an owner sets the policy');
select is((select threshold_minor from spend_policies where org_id = 'cccccc41-0000-0000-0000-0000000000c1'), 10000, 'the owner reads the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is((select count(*)::int from spend_policies where org_id = 'cccccc41-0000-0000-0000-0000000000c1'), 1, 'an admin reads the policy');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select is((select count(*)::int from spend_policies), 0, 'the provider cannot read the client policy');

-- 2. accepting with the policy on
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000002'), 'accepted', 'below the threshold an admin accepts directly');
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'at or above the threshold an admin creates a request');
select is((select accepted_by_client from contracts where id = 'dddddd41-0000-0000-0000-000000000001'), false, 'the contract is not accepted yet');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending' and price = 50000), 1, 'one pending request with the price snapshot');
reset role;
select is((select count(*)::int from notifications where type = 'spend_approval_requested' and user_id in ('aaaaaa41-0000-0000-0000-0000000000a1','aaaaaa41-0000-0000-0000-0000000000a2')), 2, 'each owner is notified');
select is((select count(*)::int from notifications where type = 'spend_approval_requested' and user_id not in ('aaaaaa41-0000-0000-0000-0000000000a1','aaaaaa41-0000-0000-0000-0000000000a2')), 0, 'nobody else is notified');
select is((select count(*)::int from notifications where type = 'spend_approval_requested' and payload ? 'price'), 0, 'notifications carry no amount');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a4',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_pending', 'a second admin sees the pending request');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), 1, 'still one pending request');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000001'), 'accepted', 'the provider side is not affected');
select is((select count(*)::int from spend_requests), 0, 'the provider cannot read the client requests');

-- 3. another currency always needs approval
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 100000, 'EUR')$$, 'policy switched to EUR');
reset role; update contracts set accepted_by_client = false where id = 'dddddd41-0000-0000-0000-000000000002'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000002'), 'approval_requested', 'a contract in another currency needs approval even below the threshold');
select lives_ok($$select spend_request_withdraw('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000002' and status = 'pending'))$$, 'the requester withdraws');
select is((select status from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000002'), 'withdrawn', 'the request is withdrawn');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 10000, 'USD')$$, 'policy back to USD');

-- 4. a terms change lapses the pending request
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_milestones('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000001','[{"title":"A","amount":25000},{"title":"B","amount":25000}]'::jsonb)$$, 'the provider changes the milestones');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'accepting the changed terms creates a new request');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'lapsed'), 1, 'the old request lapsed');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), 1, 'exactly one request is pending');

-- 5. who may decide
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), true, '')$$, '42501', null, 'an admin cannot decide');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a5',true);
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', true, '')$$, '42501', null, 'a member cannot decide');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', true, '')$$, '42501', null, 'the provider cannot decide');
reset role; create temp table t_req as select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'; grant select on t_req to authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
set local role authenticated;
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000b1', (select id from t_req), true, '')$$, '42501', null, 'the provider cannot decide the client request through its own org');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a7',true);
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req), true, '')$$, '42501', null, 'a stranger cannot decide');
reset role; update memberships set role = 'owner' where user_id = 'aaaaaa41-0000-0000-0000-0000000000a3'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req), true, '')$$, '42501', null, 'a requester promoted to owner cannot approve their own request');
reset role; update memberships set role = 'admin' where user_id = 'aaaaaa41-0000-0000-0000-0000000000a3'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req), false, '  ')$$, '22023', null, 'a rejection needs a note');

-- 6. approve
select is(spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req), true, ''), 'approved', 'an owner approves');
select is((select accepted_by_client from contracts where id = 'dddddd41-0000-0000-0000-000000000001'), true, 'approval accepts the contract for the client');
select is((select decided_by from spend_requests where id = (select id from t_req)), 'aaaaaa41-0000-0000-0000-0000000000a1'::uuid, 'the decider is recorded');
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req), true, '')$$, '22023', null, 'a decided request cannot be decided again');
reset role;
select is((select count(*)::int from notifications where type = 'spend_request_approved' and user_id = 'aaaaaa41-0000-0000-0000-0000000000a3'), 1, 'the requester is told it was approved');

-- 7. a change after the request lapses it at decision time
update contracts set accepted_by_client = false where id = 'dddddd41-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'a fresh request');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_milestones('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000001','[{"title":"A","amount":10000},{"title":"B","amount":40000}]'::jsonb)$$, 'the provider changes the milestones again');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), true, ''), 'lapsed', 'approving changed terms lapses the request');
select is((select accepted_by_client from contracts where id = 'dddddd41-0000-0000-0000-000000000001'), false, 'and does not accept the contract');

-- 8. reject
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'another request');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), false, 'Too high'), 'rejected', 'an owner rejects with a note');
select is((select note from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'rejected'), 'Too high', 'the note is kept');
reset role;
select is((select count(*)::int from notifications where type = 'spend_request_rejected' and user_id = 'aaaaaa41-0000-0000-0000-0000000000a3'), 1, 'the requester is told it was rejected');
set local role authenticated;

-- 9. withdraw rules
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'a request to withdraw');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a4',true);
select throws_ok($$select spend_request_withdraw('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'))$$, '42501', null, 'another admin cannot withdraw it');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_request_withdraw('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'))$$, 'an owner can withdraw it');
select throws_ok($$select spend_request_withdraw('cccccc41-0000-0000-0000-0000000000c1', (select id from t_req))$$, '22023', null, 'a decided request cannot be withdrawn');

-- 10. a cancelled contract lapses its request
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000003'), 'approval_requested', 'a request on K3');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select cancel_contract('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000003','changed plans')$$, 'the provider cancels the draft');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select is((select status from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000003'), 'lapsed', 'cancelling the draft lapses its request at once');
select throws_ok($$select spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000003'), true, '')$$, '22023', null, 'and it can no longer be approved');

-- 10b. review fixes: a request never outlives its contract being settled another way
reset role; update contracts set accepted_by_client = false where id = 'dddddd41-0000-0000-0000-000000000001'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'a request before an owner accepts directly');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'accepted', 'an owner accepts directly while a request is pending');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), 0, 'the direct accept lapses the pending request');
reset role; update contracts set accepted_by_client = false where id = 'dddddd41-0000-0000-0000-000000000001'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'a request before the rule is switched off');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', false, 10000, 'USD')$$, 'the owner switches the rule off');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'accepted', 'with the rule off the admin accepts directly');
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), 0, 'and the old request lapses');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc41-0000-0000-0000-0000000000c1', true, 1000, 'USD')$$, 'the rule is back on with a lower threshold');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000002'), 'approval_requested', 'a request on K2 before it is cancelled');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select cancel_contract('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000002','no longer needed')$$, 'the provider cancels K2');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is((select count(*)::int from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000002' and status = 'pending'), 0, 'cancelling lapses the pending request');
reset role;
select is((select count(*)::int from notifications where type like 'spend_%' and payload->>'org_id' = 'cccccc41-0000-0000-0000-0000000000c1'), (select count(*)::int from notifications where type like 'spend_%'), 'every approval notification names the organization');
-- the fingerprint cannot be fooled by separators inside titles
update contracts set accepted_by_client = false where id = 'dddddd41-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_milestones('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('title','a','amount',25000,'due_date','2027-01-01'), jsonb_build_object('title', 'b|25000|2027-02-01' || chr(10) || '2|c','amount',25000,'due_date','2027-03-01')))$$, 'schedule A with separators in a title');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001'), 'approval_requested', 'a request for schedule A');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_milestones('cccccc41-0000-0000-0000-0000000000b1','dddddd41-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('title', 'a|25000|2027-01-01' || chr(10) || '2|b','amount',25000,'due_date','2027-02-01'), jsonb_build_object('title','c','amount',25000,'due_date','2027-03-01')))$$, 'schedule B that would join to the same text');
select set_config('request.jwt.claim.sub','aaaaaa41-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc41-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = 'dddddd41-0000-0000-0000-000000000001' and status = 'pending'), true, ''), 'lapsed', 'a look-alike schedule still lapses the approval');

-- 11. no direct writes
select throws_ok($$insert into spend_policies (org_id, enabled, threshold_minor, currency) values ('cccccc41-0000-0000-0000-0000000000b1', true, 1, 'USD')$$, '42501', null, 'policies cannot be inserted directly');
select throws_ok($$update spend_policies set threshold_minor = 1$$, '42501', null, 'policies cannot be updated directly');
select throws_ok($$delete from spend_policies$$, '42501', null, 'policies cannot be deleted directly');
select throws_ok($$insert into spend_requests (org_id, contract_id, status, price, currency, terms_hash) values ('cccccc41-0000-0000-0000-0000000000c1','dddddd41-0000-0000-0000-000000000001','approved',1,'USD','x')$$, '42501', null, 'requests cannot be inserted directly');
select throws_ok($$update spend_requests set status = 'approved'$$, '42501', null, 'requests cannot be updated directly');
select throws_ok($$delete from spend_requests$$, '42501', null, 'requests cannot be deleted directly');
select throws_ok($$select spend_terms_hash('dddddd41-0000-0000-0000-000000000001')$$, '42501', null, 'the terms hash helper is internal');

-- 12. audit
reset role;
select is((select count(distinct action)::int from audit_log where org_id = 'cccccc41-0000-0000-0000-0000000000c1' and action in
  ('spend_policy.set','spend_request.create','spend_request.approve','spend_request.reject','spend_request.lapse','spend_request.withdraw')), 6, 'every kind of change is audited');

select * from finish();
rollback;

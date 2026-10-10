begin;
select plan(57);

insert into auth.users (id, email) values
 ('aaaaaa47-0000-0000-0000-0000000000a1','o1@x.test'),('aaaaaa47-0000-0000-0000-0000000000a2','o2@x.test'),('aaaaaa47-0000-0000-0000-0000000000a3','a1@x.test'),
 ('aaaaaa47-0000-0000-0000-0000000000a4','m@x.test'),('aaaaaa47-0000-0000-0000-0000000000a5','p@x.test');
insert into organizations (id, type, name) values ('cccccc47-0000-0000-0000-0000000000c1','client_company','Client'),('cccccc47-0000-0000-0000-0000000000b1','agency','Provider');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa47-0000-0000-0000-0000000000a1','cccccc47-0000-0000-0000-0000000000c1','owner'),('aaaaaa47-0000-0000-0000-0000000000a2','cccccc47-0000-0000-0000-0000000000c1','owner'),
 ('aaaaaa47-0000-0000-0000-0000000000a3','cccccc47-0000-0000-0000-0000000000c1','admin'),('aaaaaa47-0000-0000-0000-0000000000a4','cccccc47-0000-0000-0000-0000000000c1','member'),
 ('aaaaaa47-0000-0000-0000-0000000000a5','cccccc47-0000-0000-0000-0000000000b1','owner');
create function pg_temp.k(n int) returns uuid language sql as $$ select ('dddddd47-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.req(n int) returns uuid language sql as $$ select id from spend_requests where contract_id = pg_temp.k(n) and status = 'pending' $$;
grant execute on function pg_temp.k(int), pg_temp.req(int) to authenticated;
insert into projects (id, org_id, title, description, currency, status, visibility)
 select ('eeeeee47-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'cccccc47-0000-0000-0000-0000000000c1', 'Project ' || g, 'Detailed description', 'USD', 'open', 'public' from generate_series(1,8) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status)
 select ('ffffff47-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, ('eeeeee47-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
        'cccccc47-0000-0000-0000-0000000000b1', 'Offer', 1000, 'USD', 10, 'shortlisted' from generate_series(1,8) g;
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps)
 select pg_temp.k(g), ('eeeeee47-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, ('ffffff47-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
        'cccccc47-0000-0000-0000-0000000000c1', 'cccccc47-0000-0000-0000-0000000000b1', 'K' || g, case when g in (5, 6) then 6000 else 60000 end, 'USD', 500, 200
 from generate_series(1,8) g;
insert into milestones (contract_id, position, title, amount) select id, 1, 'Only', price from contracts where client_org_id = 'cccccc47-0000-0000-0000-0000000000c1';

set local role authenticated;

-- 1. setting tiers: owners only, validated, never more approvals than owners
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc47-0000-0000-0000-0000000000c1', true, 5000, 'USD')$$, 'an approval rule from 5,000');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":1}]')$$, '42501', null, 'an admin cannot set tiers');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":4}]')$$, '22023', null, 'at most 3 approvals');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":3}]')$$, '22023', null, 'never more approvals than the organization has owners');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":1},{"min":5000,"approvals":2}]')$$, '22023', null, 'one tier per amount');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":-1,"approvals":1}]')$$, '22023', null, 'amounts are not negative');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000}]')$$, '22023', null, 'both fields are required');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":1.5}]')$$, '22023', null, 'whole numbers only');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[5000]')$$, '22023', null, 'objects only');
select throws_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'EUR', '[{"min":5000,"approvals":1}]')$$, '22023', null, 'tiers are in the rule''s currency');
select lives_ok($$select spend_tiers_set('cccccc47-0000-0000-0000-0000000000c1', 'USD', '[{"min":5000,"approvals":1.0},{"min":50000,"approvals":2}]')$$, 'one owner from 5,000, two from 50,000');
select is((select count(*)::int from spend_tiers where org_id = 'cccccc47-0000-0000-0000-0000000000c1'), 2, 'two tiers are stored');
reset role;
select is((select count(*)::int from notifications where type = 'spend_tiers_changed' and user_id = 'aaaaaa47-0000-0000-0000-0000000000a2'), 1, 'the other owners are told the tiers changed');
select is((select after::text from audit_log where action = 'spend_tiers.set' and org_id = 'cccccc47-0000-0000-0000-0000000000c1' order by id desc limit 1),
  '[{"min": 5000, "approvals": 1}, {"min": 50000, "approvals": 2}]', 'the audit keeps the normalized tiers');
set local role authenticated;

-- 2. how many approvals a contract needs
reset role;
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 49999, 'USD'), 1, 'below the two-owner tier: one');
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 50000, 'USD'), 2, 'exactly at the tier: two');
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 99999999, 'USD'), 2, 'above the top tier: its count');
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 100, 'EUR'), 2, 'another currency takes the highest tier');
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 100, 'USD'), 1, 'below every tier: one');
update spend_policies set threshold_minor = 60000 where org_id = 'cccccc47-0000-0000-0000-0000000000c1';
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 55000, 'USD'), 1, 'below the approval threshold the tiers do not apply');
update spend_policies set currency = 'EUR', threshold_minor = 5000 where org_id = 'cccccc47-0000-0000-0000-0000000000c1';
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 6000000, 'EUR'), 2, 'after the rule''s currency changed, the highest tier applies');
update spend_policies set currency = 'USD' where org_id = 'cccccc47-0000-0000-0000-0000000000c1';
update spend_policies set enabled = false where org_id = 'cccccc47-0000-0000-0000-0000000000c1';
select is(spend_required('cccccc47-0000-0000-0000-0000000000c1', 99999999, 'USD'), 1, 'with the rule off: one');
update spend_policies set enabled = true where org_id = 'cccccc47-0000-0000-0000-0000000000c1';
select is((select count(*)::int from audit_log where action = 'spend_tiers.set' and org_id = 'cccccc47-0000-0000-0000-0000000000c1'), 1, 'setting tiers is audited');
set local role authenticated;

-- 3. an admin's request in the two-owner tier
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(1)), 'approval_requested', 'the admin''s acceptance goes to the owners');
select is((select approvals_required from spend_requests where id = pg_temp.req(1)), 2, 'and needs two approvals');
select set_config('t.r1', pg_temp.req(1)::text, false);
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r1')::uuid, true, ''), 'partial', 'the first owner''s approval is recorded');
select ok((select not accepted_by_client from contracts where id = pg_temp.k(1)), 'one approval is not enough');
select throws_ok($$select spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r1')::uuid, true, '')$$, '23505', null, 'the same owner cannot approve twice');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a2',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r1')::uuid, true, ''), 'approved', 'the second owner completes it');
reset role;
select is((select after->'approvers' from audit_log where action = 'spend_request.approve' and entity_id = current_setting('t.r1') order by id desc limit 1),
  '["aaaaaa47-0000-0000-0000-0000000000a1", "aaaaaa47-0000-0000-0000-0000000000a2"]'::jsonb, 'the audit names both approvers');
set local role authenticated;
select ok((select accepted_by_client and client_accepted_at is not null from contracts where id = pg_temp.k(1)), 'and the contract is accepted');
select is((select count(*)::int from spend_approvals where request_id = current_setting('t.r1')::uuid), 2, 'both approvals are kept');

-- 4. one rejection ends it, even after an approval
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(2)), 'approval_requested', 'another request');
select set_config('t.r2', pg_temp.req(2)::text, false);
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r2')::uuid, true, ''), 'partial', 'one approval');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a2',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r2')::uuid, false, 'Too expensive'), 'rejected', 'one rejection ends it');
select ok((select not accepted_by_client from contracts where id = pg_temp.k(2)), 'the contract is not accepted');

-- 5. changed terms lapse the approvals collected so far
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(3)), 'approval_requested', 'a third request');
select set_config('t.r3', pg_temp.req(3)::text, false);
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r3')::uuid, true, ''), 'partial', 'one approval');
reset role; update milestones set title = 'Renamed' where contract_id = pg_temp.k(3); set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a2',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', current_setting('t.r3')::uuid, true, ''), 'lapsed', 'the terms changed, so it lapses instead of completing');

-- 6. an owner's accept in the two-owner tier is only the first approval
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(4)), 'approval_requested', 'one owner alone cannot accept 60,000');
select ok((select not accepted_by_client from contracts where id = pg_temp.k(4)), 'it is not accepted');
select is((select count(*)::int from spend_approvals a join spend_requests r on r.id = a.request_id where r.contract_id = pg_temp.k(4) and a.approver_id = 'aaaaaa47-0000-0000-0000-0000000000a1'), 1, 'the owner''s accept counts as an approval');
select throws_ok(format($$select spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', %L, true, '')$$, pg_temp.req(4)), '42501', null, 'and that owner cannot approve again');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(4)), 'accepted', 'a second owner accepting completes it');
select is((select status from spend_requests where contract_id = pg_temp.k(4) order by created_at desc limit 1), 'approved', 'and the request is approved');
reset role;
select is((select count(*)::int from notifications where type = 'spend_request_approved' and user_id = 'aaaaaa47-0000-0000-0000-0000000000a1'), 1, 'the owner who asked is told it was approved');
set local role authenticated;

-- 7. one-owner tier: owners accept directly, an admin needs one owner
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(5)), 'accepted', 'an owner accepts 6,000 directly');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(6)), 'approval_requested', 'an admin''s 6,000 needs an owner');
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a2',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', pg_temp.req(6), true, ''), 'approved', 'one owner is enough');

-- 7b. a request made before the tiers were raised cannot be completed by one owner
reset role; update spend_tiers set approvals = 1 where org_id = 'cccccc47-0000-0000-0000-0000000000c1'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(7)), 'approval_requested', 'a request needing one owner');
reset role; update spend_tiers set approvals = 2 where org_id = 'cccccc47-0000-0000-0000-0000000000c1' and min_minor = 50000; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc47-0000-0000-0000-0000000000c1', pg_temp.req(7), true, ''), 'lapsed', 'after the tiers were raised it lapses instead');
select ok((select not accepted_by_client from contracts where id = pg_temp.k(7)), 'and the contract is not accepted');

-- 7c. a requester never approves their own request, even after becoming an owner
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a3',true);
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(8)), 'approval_requested', 'an admin asks');
reset role; update memberships set role = 'owner' where user_id = 'aaaaaa47-0000-0000-0000-0000000000a3' and org_id = 'cccccc47-0000-0000-0000-0000000000c1'; set local role authenticated;
select is(accept_contract('cccccc47-0000-0000-0000-0000000000c1', pg_temp.k(8)), 'approval_pending', 'promoted to owner, accepting again does not count as an approval');
select is((select count(*)::int from spend_approvals where request_id = pg_temp.req(8)), 0, 'no approval was recorded');

-- 8. privacy
select set_config('request.jwt.claim.sub','aaaaaa47-0000-0000-0000-0000000000a5',true);
select is((select count(*)::int from spend_approvals), 0, 'the provider reads no approvals');
select is((select count(*)::int from spend_tiers), 0, 'or tiers');

select * from finish();
rollback;

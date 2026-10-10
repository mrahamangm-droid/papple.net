begin;
select plan(50);

insert into auth.users (id, email) values
 ('aaaaaa45-0000-0000-0000-0000000000a1','o@x.test'),('aaaaaa45-0000-0000-0000-0000000000a2','a1@x.test'),('aaaaaa45-0000-0000-0000-0000000000a3','a2@x.test'),
 ('aaaaaa45-0000-0000-0000-0000000000a4','m@x.test'),('aaaaaa45-0000-0000-0000-0000000000a5','v@x.test'),('aaaaaa45-0000-0000-0000-0000000000a6','p@x.test'),
 ('aaaaaa45-0000-0000-0000-0000000000a7','o2@x.test');
insert into organizations (id, type, name) values
 ('cccccc45-0000-0000-0000-0000000000c1','client_company','Client'),('cccccc45-0000-0000-0000-0000000000b1','agency','Provider'),('cccccc45-0000-0000-0000-0000000000c2','client_company','Counting client');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa45-0000-0000-0000-0000000000a1','cccccc45-0000-0000-0000-0000000000c1','owner'),('aaaaaa45-0000-0000-0000-0000000000a2','cccccc45-0000-0000-0000-0000000000c1','admin'),
 ('aaaaaa45-0000-0000-0000-0000000000a3','cccccc45-0000-0000-0000-0000000000c1','admin'),('aaaaaa45-0000-0000-0000-0000000000a4','cccccc45-0000-0000-0000-0000000000c1','member'),
 ('aaaaaa45-0000-0000-0000-0000000000a5','cccccc45-0000-0000-0000-0000000000c1','viewer'),('aaaaaa45-0000-0000-0000-0000000000a6','cccccc45-0000-0000-0000-0000000000b1','owner'),
 ('aaaaaa45-0000-0000-0000-0000000000a7','cccccc45-0000-0000-0000-0000000000c2','owner');

-- contracts K1..K5 for the client (routing), K6..K10 for the counting client; one project and proposal each
create function pg_temp.k(n int) returns uuid language sql as $$ select ('dddddd45-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
insert into projects (id, org_id, title, description, currency, status, visibility)
 select ('eeeeee45-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, case when g <= 5 then 'cccccc45-0000-0000-0000-0000000000c1'::uuid else 'cccccc45-0000-0000-0000-0000000000c2'::uuid end,
        'Project ' || g, 'Detailed description', 'USD', 'open', 'public' from generate_series(1,10) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status)
 select ('ffffff45-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, ('eeeeee45-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
        'cccccc45-0000-0000-0000-0000000000b1', 'Offer', 1000, 'USD', 10, 'shortlisted' from generate_series(1,10) g;
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps)
 select pg_temp.k(g), ('eeeeee45-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, ('ffffff45-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
        case when g <= 5 then 'cccccc45-0000-0000-0000-0000000000c1'::uuid else 'cccccc45-0000-0000-0000-0000000000c2'::uuid end, 'cccccc45-0000-0000-0000-0000000000b1',
        'K' || g, p.price, p.cur, 500, 200
 from generate_series(1,10) g
 join (values (1,4000,'USD'),(2,7000,'USD'),(3,6000,'USD'),(4,6000,'USD'),(5,100,'EUR'),(6,3000,'USD'),(7,3000,'USD'),(8,500,'EUR'),(9,900,'USD'),(10,700,'USD')) p(n, price, cur) on p.n = g;
insert into milestones (contract_id, position, title, amount)
 select pg_temp.k(g), 1, 'Only', c.price from generate_series(1,10) g join contracts c on c.id = pg_temp.k(g) where g <> 7;
insert into milestones (contract_id, position, title, amount) values (pg_temp.k(7), 1, 'First', 2000), (pg_temp.k(7), 2, 'Second', 1000);

set local role authenticated;

-- 1. setting the budget: owners only, validated
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'USD')$$, '42501', null, 'an admin cannot set the budget');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a4',true);
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'USD')$$, '42501', null, 'a member cannot set the budget');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a6',true);
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'USD')$$, '42501', null, 'another organization cannot set the budget');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'year', 10000, 'USD')$$, '22023', null, 'only month or quarter');
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 0, 'USD')$$, '22023', null, 'a zero budget is refused');
select throws_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'usd')$$, '22023', null, 'the currency is validated');
select lives_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'USD')$$, 'the owner sets a quarterly budget');

-- 2. reading: owners, admins and members through budget_status; viewers and other organizations not at all
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a4',true);
select is((select (budget_status('cccccc45-0000-0000-0000-0000000000c1') - 'period_start' - 'period_end')),
  '{"enabled": true, "period": "quarter", "currency": "USD", "limit": 10000, "spent": 0, "remaining": 10000, "contracts": 0, "bookings": 0, "other_currency": 0}'::jsonb, 'a member sees the budget and its use');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a5',true);
select throws_ok($$select budget_status('cccccc45-0000-0000-0000-0000000000c1')$$, '42501', null, 'a viewer cannot');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a6',true);
select throws_ok($$select budget_status('cccccc45-0000-0000-0000-0000000000c1')$$, '42501', null, 'the provider cannot');
select is((select count(*)::int from budgets), 0, 'the provider reads no budget rows');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a7',true);
select is(budget_status('cccccc45-0000-0000-0000-0000000000c2'), null, 'no budget yet reads as null');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is((select count(*)::int from budgets), 1, 'an admin reads its budget row');
select throws_ok($$update budgets set amount_minor = 1$$, '42501', null, 'budgets cannot be written directly');

-- 3. routing an acceptance
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(1)), 'accepted', 'an admin accepts within the budget');
select ok((select client_accepted_at is not null from contracts where id = pg_temp.k(1)), 'the acceptance time is recorded');
select is((budget_status('cccccc45-0000-0000-0000-0000000000c1')->>'spent')::int, 4000, 'it counts');
reset role; update contracts set client_accepted_at = now() - interval '1 day' where id = pg_temp.k(1); set local role authenticated;
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(1)), 'accepted', 'accepting an accepted contract again is a no-op');
select ok((select client_accepted_at < now() - interval '23 hours' from contracts where id = pg_temp.k(1)), 'and does not move its acceptance time or count it twice');
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(2)), 'approval_requested', 'an admin going over the budget needs an owner');
select is((select reasons from spend_requests where contract_id = pg_temp.k(2) and status = 'pending'), '{budget}'::text[], 'the request says why');
select ok((select not accepted_by_client from contracts where id = pg_temp.k(2)), 'and the contract is not accepted');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(2)), 'accepted', 'an owner can go over the budget');
select is((select (budget_status('cccccc45-0000-0000-0000-0000000000c1')->>'remaining')::int), -1000, 'remaining can go negative');
select lives_ok($$select spend_policy_set('cccccc45-0000-0000-0000-0000000000c1', true, 5000, 'USD')$$, 'a threshold as well');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(3)), 'approval_requested', 'above the threshold and over the budget');
select is((select reasons from spend_requests where contract_id = pg_temp.k(3) and status = 'pending'), '{threshold,budget}'::text[], 'one request carries both reasons');

-- a pending threshold-only request is replaced when the budget also applies
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select lives_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', false, 'quarter', 10000, 'USD')$$, 'the budget is switched off');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(4)), 'approval_requested', 'threshold only');
select is((select reasons from spend_requests where contract_id = pg_temp.k(4) and status = 'pending'), '{threshold}'::text[], 'a threshold request');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select lives_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', true, 'quarter', 10000, 'USD')$$, 'the budget is back on');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(4)), 'approval_requested', 'accepting again with a new reason');
select is((select string_agg(status || ':' || array_to_string(reasons, '+'), ',' order by created_at) from spend_requests where contract_id = pg_temp.k(4)),
  'lapsed:threshold,pending:threshold+budget', 'the old request lapsed and the new one carries both reasons');

-- another currency cannot be checked against the budget
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select lives_ok($$select spend_policy_set('cccccc45-0000-0000-0000-0000000000c1', false, 5000, 'USD')$$, 'threshold off');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(5)), 'approval_requested', 'a contract in another currency needs an owner');
select is((select reasons from spend_requests where contract_id = pg_temp.k(5) and status = 'pending'), '{budget}'::text[], 'because of the budget');

-- approval records the acceptance time
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a1',true);
select is(spend_request_decide('cccccc45-0000-0000-0000-0000000000c1', (select id from spend_requests where contract_id = pg_temp.k(3) and status = 'pending'), true, ''), 'approved', 'the owner approves');
select ok((select accepted_by_client and client_accepted_at is not null from contracts where id = pg_temp.k(3)), 'and the acceptance time is recorded');
select lives_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c1', false, 'quarter', 10000, 'USD')$$, 'budget off');
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a2',true);
select is(accept_contract('cccccc45-0000-0000-0000-0000000000c1', pg_temp.k(5)), 'accepted', 'without a budget the admin accepts as before');

-- 4. periods (UTC, half-open)
reset role;
select is(budget_period('quarter', '2026-03-31 23:59:59+00'), tstzrange('2026-01-01 00:00+00', '2026-04-01 00:00+00'), 'the last second of a quarter belongs to it');
select is(budget_period('quarter', '2026-04-01 00:00:00+00'), tstzrange('2026-04-01 00:00+00', '2026-07-01 00:00+00'), 'the first second of the next quarter does not');
select is(budget_period('month', '2026-02-28 12:00:00+00'), tstzrange('2026-02-01 00:00+00', '2026-03-01 00:00+00'), 'a month');

-- 5. counting, in the counting client
select set_config('t.start', lower(budget_period('quarter', now()))::text, false);
update contracts set accepted_by_client = true, client_accepted_at = now() where id in (pg_temp.k(6), pg_temp.k(7), pg_temp.k(8));
update contracts set accepted_by_client = true, client_accepted_at = current_setting('t.start')::timestamptz - interval '1 second' where id = pg_temp.k(9);
update contracts set accepted_by_client = true, client_accepted_at = current_setting('t.start')::timestamptz where id = pg_temp.k(10);
update contracts set status = 'cancelled' where id = pg_temp.k(7);
insert into payments (milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status)
 select id, contract_id, amount, 40, 100, amount + 40, 140, 'USD', 'succeeded' from milestones where contract_id = pg_temp.k(7) and position = 1;
insert into services (id, org_id, slug, title, status, currency) values ('dddddd45-0000-0000-0000-0000000000f1','cccccc45-0000-0000-0000-0000000000b1','svc-45','Svc','published','USD');
insert into bookings (id, provider_org_id, client_org_id, service_id, starts_at, ends_at, blocked, status, price, currency, commission_pro_bps, commission_client_bps)
 select ('bbbbbb45-0000-0000-0000-00000000000' || g)::uuid, 'cccccc45-0000-0000-0000-0000000000b1', 'cccccc45-0000-0000-0000-0000000000c2', 'dddddd45-0000-0000-0000-0000000000f1',
        now() + make_interval(days => 10 + g), now() + make_interval(days => 10 + g, hours => 1), tstzrange(now() + make_interval(days => 10 + g), now() + make_interval(days => 10 + g, hours => 1)),
        case when g in (2, 3) then 'cancelled' else 'confirmed' end, 2000, case when g = 4 then 'EUR' else 'USD' end, 500, 200
 from generate_series(1,4) g;
insert into booking_payments (booking_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status, paid_at)
 select ('bbbbbb45-0000-0000-0000-00000000000' || g)::uuid, 2000, 40, 100, 2040, 140, case when g = 4 then 'EUR' else 'USD' end,
        case g when 2 then 'refunded' when 3 then 'refund_pending' else 'succeeded' end, now()
 from generate_series(1,4) g;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa45-0000-0000-0000-0000000000a7',true);
select lives_ok($$select budget_set('cccccc45-0000-0000-0000-0000000000c2', true, 'quarter', 10000, 'USD')$$, 'the counting client sets a budget');
select is((select budget_status('cccccc45-0000-0000-0000-0000000000c2')->>'contracts')::int, 5700,
  'contracts: the accepted price, only what was paid on a cancelled one, nothing from before the period, and the first second of the period counts');
select is((select budget_status('cccccc45-0000-0000-0000-0000000000c2')->>'bookings')::int, 2000, 'bookings: paid ones count, refunded or refund pending do not');
select is((select budget_status('cccccc45-0000-0000-0000-0000000000c2')->>'other_currency')::int, 2, 'a contract and a booking in another currency are listed, not added');
select is((select budget_status('cccccc45-0000-0000-0000-0000000000c2')->>'spent')::int, 7700, 'spent is contracts plus bookings');

reset role;
select is((select count(*)::int from audit_log where action = 'budget.set' and org_id = 'cccccc45-0000-0000-0000-0000000000c1'), 4, 'every budget change is audited');
select is((select before->>'enabled' || '>' || (after->>'enabled') from audit_log where action = 'budget.set' and org_id = 'cccccc45-0000-0000-0000-0000000000c1' order by id desc limit 1),
  'true>false', 'with what changed');

select * from finish();
rollback;

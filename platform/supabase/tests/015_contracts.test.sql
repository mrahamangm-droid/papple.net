begin;
select plan(23);

insert into auth.users (id, email) values
 ('aaaaaa15-0000-0000-0000-000000000001','client@x.test'),
 ('aaaaaa15-0000-0000-0000-000000000002','prov@x.test'),
 ('aaaaaa15-0000-0000-0000-000000000003','stranger@x.test'),
 ('aaaaaa15-0000-0000-0000-000000000004','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc15-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc15-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc15-0000-0000-0000-000000000003','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa15-0000-0000-0000-000000000002','cccccc15-0000-0000-0000-000000000001','owner'),
 ('aaaaaa15-0000-0000-0000-000000000003','cccccc15-0000-0000-0000-000000000003','owner');
insert into platform_roles (user_id, role) values ('aaaaaa15-0000-0000-0000-000000000004','admin');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-00000000000c','Project','Detailed description','USD','open','public');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff15-0000-0000-0000-000000000001','eeeeee15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-000000000001','Offer',100000,'USD',10,'shortlisted');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps) values
 ('dddddd15-0000-0000-0000-000000000001','eeeeee15-0000-0000-0000-000000000001','ffffff15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-00000000000c','cccccc15-0000-0000-0000-000000000001','Contract',100000,'USD',500,200);
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff15-0000-0000-0000-000000000002','eeeeee15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-000000000003','Other offer',90000,'USD',10,'shortlisted');
insert into milestones (contract_id, position, title, amount) values
 ('dddddd15-0000-0000-0000-000000000001',1,'First',40000),
 ('dddddd15-0000-0000-0000-000000000001',2,'Second',60000);
insert into connected_accounts (org_id, stripe_account_id, payouts_enabled) values
 ('cccccc15-0000-0000-0000-000000000001','acct_test_123',true);

select ok((select relrowsecurity from pg_class where oid='public.contracts'::regclass), 'contracts has RLS');
select ok((select relrowsecurity from pg_class where oid='public.milestones'::regclass), 'milestones has RLS');
select ok((select relrowsecurity from pg_class where oid='public.connected_accounts'::regclass), 'connected_accounts has RLS');
select throws_ok($$insert into milestones (contract_id, position, title, amount) values ('dddddd15-0000-0000-0000-000000000001',1,'Dup',1)$$, '23505', null, 'milestone position is unique per contract');
select lives_ok($$update proposals set status = 'hired' where id = 'ffffff15-0000-0000-0000-000000000001'$$, 'proposals accept the hired status');
select throws_ok($$insert into contracts (project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps) values ('eeeeee15-0000-0000-0000-000000000001','ffffff15-0000-0000-0000-000000000002','cccccc15-0000-0000-0000-00000000000c','cccccc15-0000-0000-0000-000000000003','Second',90000,'USD',500,200)$$, '23505', null, 'a project can have only one live contract');
select ok((select count(*) = 4 from platform_settings where key in ('payments.min_application_fee_minor','reviews.reveal_after_days','contracts.max_milestones','payments.checkout_expiry_minutes')), 'contract settings are seeded as data');

set local role anon;
select throws_ok($$select * from contracts$$, '42501', null, 'anon cannot read contracts');
reset role; set local role authenticated;

select set_config('request.jwt.claim.sub','aaaaaa15-0000-0000-0000-000000000003',true);
select is((select count(*)::int from contracts), 0, 'stranger sees no contracts');
select is((select count(*)::int from milestones), 0, 'stranger sees no milestones');

select set_config('request.jwt.claim.sub','aaaaaa15-0000-0000-0000-000000000001',true);
select is((select count(*)::int from contracts), 1, 'client org member sees the contract');
select is((select count(*)::int from milestones), 2, 'client org member sees the milestones');
select is((select count(*)::int from connected_accounts), 0, 'client org member cannot see the provider payout account');
select throws_ok($$insert into contracts (project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps) values ('eeeeee15-0000-0000-0000-000000000001','ffffff15-0000-0000-0000-000000000001','cccccc15-0000-0000-0000-00000000000c','cccccc15-0000-0000-0000-000000000001','x',1,'USD',0,0)$$, '42501', null, 'clients cannot insert contracts directly');
select throws_ok($$update contracts set status = 'completed'$$, '42501', null, 'clients cannot update contracts directly');
select throws_ok($$delete from contracts$$, '42501', null, 'clients cannot delete contracts');
select throws_ok($$insert into milestones (contract_id, position, title, amount) values ('dddddd15-0000-0000-0000-000000000001',9,'x',1)$$, '42501', null, 'clients cannot insert milestones directly');

select set_config('request.jwt.claim.sub','aaaaaa15-0000-0000-0000-000000000002',true);
select is((select count(*)::int from contracts), 1, 'provider org member sees the contract');
select is((select payouts_enabled from connected_accounts), true, 'provider owner sees own payout status');
select throws_ok($$select stripe_account_id from connected_accounts$$, '42501', null, 'the Stripe account id is never readable by clients');
select throws_ok($$insert into connected_accounts (org_id, stripe_account_id) values ('cccccc15-0000-0000-0000-000000000001','acct_x')$$, '42501', null, 'clients cannot write connected accounts');

select set_config('request.jwt.claim.sub','aaaaaa15-0000-0000-0000-000000000004',true);
select is((select count(*)::int from contracts), 1, 'platform admin sees the contract');

reset role;
select lives_ok($$insert into contracts (project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values ('eeeeee15-0000-0000-0000-000000000001','ffffff15-0000-0000-0000-000000000002','cccccc15-0000-0000-0000-00000000000c','cccccc15-0000-0000-0000-000000000003','Second',90000,'USD',500,200,'cancelled')$$, 'a cancelled contract does not block hiring again');

select * from finish();
rollback;

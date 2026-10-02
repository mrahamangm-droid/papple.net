begin;
select plan(28);
insert into auth.users (id, email) values
 ('aaaaaa23-0000-0000-0000-000000000001','client@x.test'),('aaaaaa23-0000-0000-0000-000000000003','prov@x.test'),
 ('aaaaaa23-0000-0000-0000-000000000005','support@x.test'),('aaaaaa23-0000-0000-0000-000000000007','admin@x.test'),
 ('aaaaaa23-0000-0000-0000-000000000008','admin2@x.test'),('aaaaaa23-0000-0000-0000-000000000009','plain@x.test');
insert into organizations (id, type, name) values
 ('cccccc23-0000-0000-0000-00000000000c','client_company','Client Co'),('cccccc23-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc23-0000-0000-0000-000000000002','individual','Closed One');
update organizations set status = 'closed' where id = 'cccccc23-0000-0000-0000-000000000002';
insert into memberships (user_id, org_id, role) values
 ('aaaaaa23-0000-0000-0000-000000000001','cccccc23-0000-0000-0000-00000000000c','owner'),('aaaaaa23-0000-0000-0000-000000000003','cccccc23-0000-0000-0000-000000000001','owner');
insert into platform_roles (user_id, role) values ('aaaaaa23-0000-0000-0000-000000000005','support'),('aaaaaa23-0000-0000-0000-000000000007','admin');
insert into provider_profiles (org_id, slug, headline) values ('cccccc23-0000-0000-0000-000000000001','prov-one-23','Provider headline');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee23-0000-0000-0000-000000000001','cccccc23-0000-0000-0000-00000000000c','Project','Detailed description','USD','closed','public');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff23-0000-0000-0000-000000000001','eeeeee23-0000-0000-0000-000000000001','cccccc23-0000-0000-0000-000000000001','Offer',10000,'USD',10,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('dddddd23-0000-0000-0000-000000000001','eeeeee23-0000-0000-0000-000000000001','ffffff23-0000-0000-0000-000000000001','cccccc23-0000-0000-0000-00000000000c','cccccc23-0000-0000-0000-000000000001','Contract',10000,'USD',500,200,'active');
insert into milestones (id, contract_id, position, title, amount, status) values ('99999923-0000-0000-0000-000000000001','dddddd23-0000-0000-0000-000000000001',1,'M1',10000,'approved');
insert into payments (id, milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888823-0000-0000-0000-000000000001','99999923-0000-0000-0000-000000000001','dddddd23-0000-0000-0000-000000000001',10000,200,500,10200,700,'USD','pending');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000009',true);
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','suspended','a valid reason here')$$, '42501', null, 'a user cannot suspend an organization');
select throws_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000009','support',true,'a valid reason here')$$, '42501', null, 'a user cannot grant a role');
select is((select count(*)::int from platform_roles), 0, 'a user sees no platform_roles rows but their own');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','suspended','a valid reason here')$$, '42501', null, 'support cannot suspend');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','suspended','a valid reason here')$$, '42501', null, 'admin without aal2 cannot suspend');
select throws_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000009','support',true,'a valid reason here')$$, '42501', null, 'admin without aal2 cannot grant');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select count(*)::int from platform_roles), 2, 'an admin reads every platform_roles row');
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','closed','a valid reason here')$$, '22023', null, 'only active and suspended are settable');
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000002','active','a valid reason here')$$, '22023', null, 'a closed organization cannot be reopened here');
select throws_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','suspended','short')$$, '22023', null, 'a short reason is refused');
select lives_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','suspended','Chargeback abuse under review')$$, 'admin suspends an organization');
reset role;
select is((select count(*)::int from public_provider_cards where slug = 'prov-one-23'), 0, 'a suspended provider leaves the public cards');
select is((select count(*)::int from audit_log where action = 'admin.org.status' and entity_id = 'cccccc23-0000-0000-0000-000000000001' and after ->> 'status' = 'suspended'), 1, 'the suspension is audited');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{}',true);
select is((select is_member('cccccc23-0000-0000-0000-000000000001')), false, 'a member of a suspended org is not a member');
select is((select has_org_role('cccccc23-0000-0000-0000-000000000001', array['owner'])), false, 'a suspended org owner has no role');
select is((select count(*)::int from contracts), 0, 'the suspended provider cannot read its contract');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000001',true);
select is((select count(*)::int from contracts), 1, 'the counterparty still reads the shared contract');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select count(*)::int from contracts), 1, 'platform admin still reads everything');
reset role;
set local role service_role;
select is((select record_payment_succeeded('88888823-0000-0000-0000-000000000001','cs_23','pi_23',10200,'USD')), 'recorded', 'a payment for a suspended provider is still recorded');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_set_org_status('cccccc23-0000-0000-0000-000000000001','active','Review finished, restoring')$$, 'admin restores the organization');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000003',true);
select is((select is_member('cccccc23-0000-0000-0000-000000000001')), true, 'a restored organization has members again');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000007',true);
select throws_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000007','admin',false,'a valid reason here')$$, '22023', null, 'no one changes their own role');
select throws_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000009','owner',true,'a valid reason here')$$, '22023', null, 'an unknown role is refused');
select lives_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000008','admin',true,'Second administrator for cover')$$, 'admin grants a role');
select lives_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000008','admin',false,'Rotating the second administrator out')$$, 'admin revokes another admin when one remains');
select set_config('request.jwt.claim.sub','aaaaaa23-0000-0000-0000-000000000008',true);
select throws_ok($$select admin_set_platform_role('aaaaaa23-0000-0000-0000-000000000007','admin',false,'a valid reason here')$$, '42501', null, 'a revoked admin can no longer revoke the remaining admin');
reset role;
select is((select count(*)::int from platform_roles where role = 'admin'), 1, 'an administrator always remains');
select is((select count(*)::int from audit_log where action = 'admin.role.set'), 2, 'role changes are audited');
select * from finish();
rollback;

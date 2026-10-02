begin;
select plan(25);
insert into auth.users (id, email) values
 ('aaaaaa24-0000-0000-0000-000000000001','owner@x.test'),('aaaaaa24-0000-0000-0000-000000000002','member@x.test'),
 ('aaaaaa24-0000-0000-0000-000000000003','stranger@x.test'),('aaaaaa24-0000-0000-0000-000000000005','support@x.test'),
 ('aaaaaa24-0000-0000-0000-000000000007','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc24-0000-0000-0000-000000000001','individual','Provider One'),('cccccc24-0000-0000-0000-000000000002','individual','No Profile'),
 ('cccccc24-0000-0000-0000-000000000003','individual','Hidden Co');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa24-0000-0000-0000-000000000001','cccccc24-0000-0000-0000-000000000001','owner'),
 ('aaaaaa24-0000-0000-0000-000000000002','cccccc24-0000-0000-0000-000000000001','member'),
 ('aaaaaa24-0000-0000-0000-000000000001','cccccc24-0000-0000-0000-000000000002','owner'),
 ('aaaaaa24-0000-0000-0000-000000000001','cccccc24-0000-0000-0000-000000000003','owner');
insert into platform_roles (user_id, role) values ('aaaaaa24-0000-0000-0000-000000000005','support'),('aaaaaa24-0000-0000-0000-000000000007','admin');
insert into provider_profiles (org_id, slug, headline, status) values
 ('cccccc24-0000-0000-0000-000000000001','prov-24','Provider headline','active'),
 ('cccccc24-0000-0000-0000-000000000003','hidden-24','Hidden headline','hidden_by_admin');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000003',true);
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked','https://example.com/proof')$$, '42501', null, 'a stranger cannot request');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000002',true);
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked','https://example.com/proof')$$, '42501', null, 'a plain member cannot request');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000001',true);
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000002','Registered company, documents linked','https://example.com/proof')$$, '22023', null, 'an organization without a provider profile cannot request');
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','too short','https://example.com/proof')$$, '22023', null, 'a short note is refused');
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked','http://example.com/proof')$$, '22023', null, 'a non-https link is refused');
select lives_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked','https://example.com/proof')$$, 'an owner requests verification');
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked again',null)$$, '22023', null, 'only one pending request per organization');
select is((select count(*)::int from verification_requests), 1, 'the owner reads the request');
select throws_ok($$update provider_profiles set verified_at = now() where org_id = 'cccccc24-0000-0000-0000-000000000001'$$, '42501', null, 'owners cannot write verified_at directly');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000002',true);
select is((select count(*)::int from verification_requests), 0, 'a plain member does not see requests');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select count(*)::int from verification_requests), 1, 'support reads requests');
select throws_ok($$select review_verification((select id from verification_requests limit 1),'approved','Looks genuine to me')$$, '42501', null, 'support cannot review');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select review_verification((select id from verification_requests limit 1),'approved','Looks genuine to me')$$, '42501', null, 'admin without aal2 cannot review');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select review_verification((select id from verification_requests limit 1),'maybe','Looks genuine to me')$$, '22023', null, 'unknown decision refused');
select throws_ok($$select review_verification((select id from verification_requests limit 1),'approved','short')$$, '22023', null, 'short review note refused');
select lives_ok($$select review_verification((select id from verification_requests limit 1),'approved','Registry entry matches the evidence supplied')$$, 'admin approves');
select throws_ok($$select review_verification((select id from verification_requests limit 1),'rejected','Reviewing the same request twice')$$, '22023', null, 'only a pending request can be reviewed');
reset role;
select is((select count(*)::int from public_provider_cards where slug = 'prov-24' and verified), 1, 'the public card shows verified after approval');
select is((select count(*)::int from notifications where user_id = 'aaaaaa24-0000-0000-0000-000000000001' and type = 'verification_approved'), 1, 'the owner is notified');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000001','Registered company, documents linked','https://example.com/proof')$$, '22023', null, 'an already verified organization cannot re-request');
select throws_ok($$select request_verification('cccccc24-0000-0000-0000-000000000003','Registered company, documents linked','https://example.com/proof')$$, '22023', null, 'a hidden profile cannot request');
select set_config('request.jwt.claim.sub','aaaaaa24-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select revoke_verification('cccccc24-0000-0000-0000-000000000002','a valid reason here')$$, '22023', null, 'revoking an unverified organization is refused');
select lives_ok($$select revoke_verification('cccccc24-0000-0000-0000-000000000001','Evidence found to be out of date')$$, 'admin revokes verification');
reset role;
select is((select count(*)::int from public_provider_cards where slug = 'prov-24' and verified), 0, 'the badge disappears after revocation');
select is((select count(*)::int from audit_log where action in ('verification.request','verification.review','verification.revoke')), 3, 'request, review and revoke are audited');
select * from finish();
rollback;

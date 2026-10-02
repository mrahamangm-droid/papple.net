begin;
select plan(20);

insert into auth.users (id, email) values
 ('aaaaaa12-0000-0000-0000-000000000001','admin@x.test'),
 ('aaaaaa12-0000-0000-0000-000000000002','support@x.test'),
 ('aaaaaa12-0000-0000-0000-000000000003','owner@x.test'),
 ('aaaaaa12-0000-0000-0000-000000000004','reporter@x.test');
insert into platform_roles (user_id, role) values
 ('aaaaaa12-0000-0000-0000-000000000001','admin'),
 ('aaaaaa12-0000-0000-0000-000000000002','support');
insert into organizations (id, type, name) values
 ('cccccc12-0000-0000-0000-00000000000a','individual','Provider P'),
 ('cccccc12-0000-0000-0000-00000000000c','client_company','Client C');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa12-0000-0000-0000-000000000003','cccccc12-0000-0000-0000-00000000000a','owner');
insert into provider_profiles (id, org_id, slug, headline) values
 ('dddddd12-0000-0000-0000-000000000001','cccccc12-0000-0000-0000-00000000000a','provider-p','Provider P headline');
insert into services (id, org_id, slug, title, status) values
 ('dddddd12-0000-0000-0000-000000000002','cccccc12-0000-0000-0000-00000000000a','svc-p','Service by P','published');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee12-0000-0000-0000-000000000001','cccccc12-0000-0000-0000-00000000000c','Open project','Detailed description','USD','open','public');

set local role anon;
select throws_ok($$select report_content('profile','dddddd12-0000-0000-0000-000000000001','spam')$$, '42501', null, 'anon cannot report');
reset role; set local role authenticated;

-- reporting
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000004',true);
select lives_ok($$select report_content('profile','dddddd12-0000-0000-0000-000000000001','Looks like spam')$$, 'signed-in user reports a profile');
select throws_ok($$select report_content('profile','dddddd12-0000-0000-0000-000000000001','Still spam')$$, '23505', null, 'duplicate open report refused');
select throws_ok($$select report_content('profile','dddddd12-0000-0000-0000-000000000001','   ')$$, '22023', null, 'blank reason refused');
select throws_ok($$select report_content('profile',gen_random_uuid(),'ghost')$$, '22023', null, 'unknown target refused');
select throws_ok($$select report_content('banana','dddddd12-0000-0000-0000-000000000001','x')$$, '22023', null, 'unknown kind refused');
select is((select count(*) from content_reports)::int, 1, 'reporter reads own report');
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000003',true);
select is((select count(*) from content_reports)::int, 0, 'reported party cannot read the report');
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000002',true);
select is((select count(*) from content_reports)::int, 1, 'support staff can read reports');

-- hiding content
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000004',true);
select throws_ok($$select admin_set_visibility('profile','dddddd12-0000-0000-0000-000000000001',true,'abuse')$$, '42501', null, 'non-staff cannot hide content');
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000001',true);
select throws_ok($$select admin_set_visibility('profile','dddddd12-0000-0000-0000-000000000001',true,'abuse')$$, '42501', null, 'staff without a verified second factor cannot hide content');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_set_visibility('profile','dddddd12-0000-0000-0000-000000000001',true,'Confirmed spam')$$, 'admin with aal2 hides a profile');
reset role; set local role anon;
select is((select count(*) from public_provider_cards)::int, 0, 'hidden profile leaves the public view');
select is((select count(*) from search_provider_cards('provider', null, null, null, null, null, null, null, 20))::int, 0, 'hidden profile leaves search');
reset role;
select is((select count(*) from audit_log where action = 'marketplace.hide' and entity = 'provider_profile')::int, 1, 'hiding writes an audit row');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_set_visibility('profile','dddddd12-0000-0000-0000-000000000001',false,'Reviewed, restored')$$, 'support staff can unhide');
reset role; set local role anon;
select is((select count(*) from public_provider_cards)::int, 1, 'unhidden profile returns to the public view');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_set_visibility('service','dddddd12-0000-0000-0000-000000000002',true,'Confirmed abuse'), admin_set_visibility('project','eeeeee12-0000-0000-0000-000000000001',true,'Confirmed abuse')$$, 'staff hide a service and a project');
reset role; set local role anon;
select is((select count(*) from public_service_cards)::int + (select count(*) from public_open_projects)::int, 0, 'hidden service and project leave public views');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa12-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select admin_set_visibility('profile',gen_random_uuid(),true,'Ghost target check')$$, '22023', null, 'unknown target refused');

select * from finish();
rollback;

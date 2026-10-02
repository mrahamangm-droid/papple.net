begin;
select plan(24);

insert into auth.users (id, email) values
 ('aaaaaaa9-0000-0000-0000-000000000001','client-owner@x.test'),
 ('aaaaaaa9-0000-0000-0000-000000000002','client-viewer@x.test'),
 ('aaaaaaa9-0000-0000-0000-000000000003','provider@x.test'),
 ('aaaaaaa9-0000-0000-0000-000000000004','stranger@x.test'),
 ('aaaaaaa9-0000-0000-0000-000000000005','other-client@x.test');
insert into organizations (id, type, name) values
 ('cccccccc-9999-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccccc-9999-0000-0000-00000000000d','client_company','Other Client Co'),
 ('cccccccc-9999-0000-0000-00000000000e','individual','Provider Pro');
insert into memberships (user_id, org_id, role) values
 ('aaaaaaa9-0000-0000-0000-000000000001','cccccccc-9999-0000-0000-00000000000c','owner'),
 ('aaaaaaa9-0000-0000-0000-000000000002','cccccccc-9999-0000-0000-00000000000c','viewer'),
 ('aaaaaaa9-0000-0000-0000-000000000003','cccccccc-9999-0000-0000-00000000000e','owner'),
 ('aaaaaaa9-0000-0000-0000-000000000005','cccccccc-9999-0000-0000-00000000000d','owner');

set local role anon;
select throws_ok($$select * from projects$$, '42501', null, 'anon cannot read projects');
reset role; set local role authenticated;

-- creation rules
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000002',true);
select throws_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000c', null, 'Build a villa', 'Need a design team', null, 1000, 5000, 'USD', current_date + 30, 'public', array[]::uuid[])$$, '42501', null, 'viewer cannot create a project');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000003',true);
select throws_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000e', null, 'Provider project', 'desc here', null, 1000, 5000, 'USD', current_date + 30, 'public', array[]::uuid[])$$, '22023', null, 'individual provider org cannot post a project');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000001',true);
select throws_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000c', null, 'Build a villa', 'Need a design team', null, 1000, 5000, 'USD', current_date - 1, 'public', array[]::uuid[])$$, '22023', null, 'deadline in the past refused');
select throws_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000c', null, 'Build a villa', 'Need a design team', null, 9000, 5000, 'USD', current_date + 30, 'public', array[]::uuid[])$$, '22023', null, 'budget_min above budget_max refused');
select lives_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000c', null, 'Build a villa', 'Need a design team', (select id from categories where slug='architecture'), 1000, 5000, 'USD', current_date + 30, 'members_only', (select array_agg(id) from (select id from skills order by slug limit 2) s))$$, 'owner creates a draft project');
select is((select status from projects limit 1), 'draft', 'new projects start as draft');

-- visibility of a draft
select is((select count(*) from projects)::int, 1, 'client org member sees own draft');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000003',true);
select is((select count(*) from projects)::int, 0, 'provider does not see a draft');

-- publish
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000001',true);
select lives_ok($$select set_project_status('cccccccc-9999-0000-0000-00000000000c', (select id from projects limit 1), 'open')$$, 'owner opens the project');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000003',true);
select is((select count(*) from projects)::int, 1, 'provider sees the open project');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000004',true);
select is((select count(*) from projects)::int, 0, 'user without a provider org does not see it');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000003',true);
select throws_ok($$select created_by from projects$$, '42501', null, 'creator identity column is not readable');

-- cross-org write refused
reset role;
create temp table proj as select id from projects where title='Build a villa';
grant select on proj to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000005',true);
select throws_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000d', (select id from proj), 'Hijack', 'desc here', null, 1, 2, 'USD', current_date + 3, 'public', array[]::uuid[])$$, '42501', null, 'cannot edit another org project by passing own org');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000001',true);
select throws_ok($$select set_project_status('cccccccc-9999-0000-0000-00000000000c', (select id from projects limit 1), 'draft')$$, '22023', null, 'open cannot go back to draft');

-- public view
reset role; set local role anon;
select is((select count(*) from public_open_projects)::int, 0, 'members_only project not in public view');
reset role;
update projects set visibility='public';
set local role anon;
select is((select count(*) from public_open_projects)::int, 1, 'public open project appears in public view');
select is((select count(*) from information_schema.columns where table_name='public_open_projects' and column_name in ('org_id','created_by'))::int, 0, 'public project view exposes no org or creator');

-- premoderation switch (setting, not code)
reset role;
update platform_settings set value='true'::jsonb where key='marketplace.premoderation';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000001',true);
select lives_ok($$select upsert_project('cccccccc-9999-0000-0000-00000000000c', null, 'Second project', 'another description', null, 100, 200, 'USD', current_date + 10, 'public', array[]::uuid[])$$, 'second project created');
select lives_ok($$select set_project_status('cccccccc-9999-0000-0000-00000000000c', (select id from projects where title='Second project'), 'open')$$, 'second project submitted');
select is((select status from projects where title='Second project'), 'pending_review', 'premoderation routes new projects to review');

-- saved items are private to their owner
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000003',true);
select lives_ok($$insert into saved_items (user_id, kind, target_id) select auth.uid(), 'project', id from projects where title='Build a villa'$$, 'provider saves a project');
select throws_ok($$insert into saved_items (user_id, kind, target_id) values ('aaaaaaa9-0000-0000-0000-000000000004','project', gen_random_uuid())$$, '42501', null, 'cannot save on behalf of another user');
select set_config('request.jwt.claim.sub','aaaaaaa9-0000-0000-0000-000000000004',true);
select is((select count(*) from saved_items)::int, 0, 'other users cannot see saved items');

select * from finish();
rollback;

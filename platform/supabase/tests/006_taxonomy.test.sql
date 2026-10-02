begin;
select plan(11);

insert into auth.users (id, email) values
 ('aaaaaaa6-0000-0000-0000-000000000001','admin@x.test'),
 ('aaaaaaa6-0000-0000-0000-000000000002','user@x.test');
insert into platform_roles (user_id, role) values ('aaaaaaa6-0000-0000-0000-000000000001','admin');
insert into organizations (id, type, name) values ('cccccccc-6666-0000-0000-000000000001','individual','Solo Pro');

-- seeded taxonomy exists and is public
set local role anon;
select ok((select count(*) from categories where is_active) >= 5, 'anon reads active categories');
select ok((select count(*) from skills where is_active) >= 5, 'anon reads active skills');
select throws_ok($$insert into categories (slug, name) values ('hack','Hack')$$, '42501', null, 'anon cannot write categories');

-- ordinary user cannot write
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa6-0000-0000-0000-000000000002',true);
select throws_ok($$insert into categories (slug, name) values ('hack','Hack')$$, '42501', null, 'user cannot insert category (rls)');
select throws_ok($$insert into skills (slug, name) values ('hack','Hack')$$, '42501', null, 'user cannot insert skill (rls)');

-- platform admin can, and inactive rows hide from anon
select set_config('request.jwt.claim.sub','aaaaaaa6-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_save_category(null,'secret-cat','Secret',null,0,false,'Creating an inactive category')$$, 'platform admin can create a category through the guarded function');
reset role; set local role anon;
select is((select count(*) from categories where slug='secret-cat')::int, 0, 'anon cannot see inactive category');

-- org_limit resolution
reset role;
select is(org_limit('cccccccc-6666-0000-0000-000000000001','limits.max_services'), 5, 'default plan service limit is 5');
update platform_settings set value='{"default":null}'::jsonb where key='limits.max_services';
select is(org_limit('cccccccc-6666-0000-0000-000000000001','limits.max_services'), null, 'null means unlimited');
select is(org_limit('cccccccc-6666-0000-0000-000000000001','limits.nope'), null, 'unknown key returns null');
select is(org_plan_key('cccccccc-6666-0000-0000-000000000001'), 'free', 'plan key is free until subscriptions exist');

select * from finish();
rollback;

begin;
select plan(7);
insert into auth.users (id, email) values
 ('aaaaaaa5-0000-0000-0000-000000000001','o1@x.test'),
 ('aaaaaaa5-0000-0000-0000-000000000002','o2@x.test'),
 ('aaaaaaa5-0000-0000-0000-000000000003','other@x.test');

-- last-owner guard
insert into organizations (id, type, name) values ('cccccccc-5555-0000-0000-000000000001','agency','Solo Org');
insert into memberships (user_id, org_id, role) values ('aaaaaaa5-0000-0000-0000-000000000001','cccccccc-5555-0000-0000-000000000001','owner');
select throws_ok($$update memberships set role='member' where user_id='aaaaaaa5-0000-0000-0000-000000000001'$$, 'P0001', 'organization must keep at least one owner', 'sole owner cannot be demoted');
select throws_ok($$delete from memberships where user_id='aaaaaaa5-0000-0000-0000-000000000001'$$, 'P0001', 'organization must keep at least one owner', 'sole owner cannot be removed');
insert into memberships (user_id, org_id, role) values ('aaaaaaa5-0000-0000-0000-000000000002','cccccccc-5555-0000-0000-000000000001','owner');
select lives_ok($$update memberships set role='admin' where user_id='aaaaaaa5-0000-0000-0000-000000000001'$$, 'an owner can step down when another owner remains');
select lives_ok($$delete from organizations where id='cccccccc-5555-0000-0000-000000000001'$$, 'deleting an organization cascades without tripping the guard');

-- org creation cap (configurable)
update platform_settings set value='2'::jsonb where key='limits.max_orgs_per_user';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa5-0000-0000-0000-000000000003',true);
select lives_ok($$select create_organization('One','individual')$$, 'first organization is allowed');
select lives_ok($$select create_organization('Two','individual')$$, 'second organization is allowed (limit 2)');
select throws_ok($$select create_organization('Three','individual')$$, '54000', 'organization limit reached', 'third organization is refused');

select * from finish();
rollback;

begin;
create function extensions.t_rows_affected(q text) returns int language plpgsql as
$$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
select plan(15);

-- fixtures (superuser bypasses RLS)
insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111','a@x.test'),  -- A owner of org A
 ('22222222-2222-2222-2222-222222222222','b@x.test'),  -- B owner of org B
 ('33333333-3333-3333-3333-333333333333','c@x.test'),  -- C viewer of org A
 ('44444444-4444-4444-4444-444444444444','d@x.test'),  -- D admin of org A
 ('55555555-5555-5555-5555-555555555555','f@x.test'),  -- F member of A and B
 ('66666666-6666-6666-6666-666666666666','g@x.test');  -- G no org
insert into organizations (id, type, name, created_by) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','client_company','Org A','11111111-1111-1111-1111-111111111111'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','agency','Org B','22222222-2222-2222-2222-222222222222');
insert into memberships (user_id, org_id, role) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','owner'),
 ('22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner'),
 ('33333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','viewer'),
 ('44444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','admin'),
 ('55555555-5555-5555-5555-555555555555','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member'),
 ('55555555-5555-5555-5555-555555555555','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','member');

select is((select count(*)::int from profiles where id='11111111-1111-1111-1111-111111111111'), 1,
  'profile row is created automatically for a new auth user');

-- as user A (owner of org A)
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);

select is((select count(*)::int from organizations where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0,
  'A cannot read org B');
select is((select count(*)::int from memberships where org_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0,
  'A cannot read org B memberships');
select throws_ok($$insert into memberships (user_id, org_id, role) values ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner')$$,
  '42501', null, 'A cannot insert a membership into org B');
select is((select count(*)::int from profiles where id='22222222-2222-2222-2222-222222222222'), 0,
  'A cannot read the profile of a user outside shared orgs');
select is((select count(*)::int from profiles where id='44444444-4444-4444-4444-444444444444'), 1,
  'A can read the profile of a user in the same org');
select is(extensions.t_rows_affected($q$update organizations set name='Org A2' where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$), 1,
  'owner can update own org');

-- as D (admin of org A): cannot mint owners
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
select throws_ok($$insert into memberships (user_id, org_id, role) values ('66666666-6666-6666-6666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','owner')$$,
  '42501', null, 'admin cannot grant owner role');

-- as C (viewer of org A)
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select is(extensions.t_rows_affected($q$update organizations set name='hacked' where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$), 0,
  'viewer cannot update org');
select throws_ok($$update memberships set role='owner' where user_id='33333333-3333-3333-3333-333333333333'$$, '42501', null,
  'viewer cannot self-promote to owner (memberships are not writable directly)');

-- as F (member of two orgs)
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select is((select count(*)::int from organizations), 2, 'multi-org user sees exactly their two orgs');
reset role;
delete from memberships where user_id='55555555-5555-5555-5555-555555555555' and org_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select is((select count(*)::int from organizations), 1,
  'removed member loses access immediately (RLS reads memberships live, not JWT)');

-- platform_roles not writable by authenticated users
select throws_ok($$insert into platform_roles (user_id, role) values ('55555555-5555-5555-5555-555555555555','admin')$$,
  '42501', null, 'authenticated users cannot grant themselves platform roles');

-- create_organization RPC makes caller the owner
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
create temp table t_org as select create_organization('G Co','individual') as id;
select is(has_org_role((select id from t_org), array['owner']), true,
  'create_organization makes the caller owner');

-- anon has no access
reset role;
set local role anon;
select throws_ok($$select count(*) from organizations$$, '42501', null, 'anon cannot read organizations');

select * from finish();
rollback;

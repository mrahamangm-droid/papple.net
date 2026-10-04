begin;
select plan(85);
create function extensions.t_pid(s text) returns uuid language sql security definer set search_path = public as $$ select id from provider_profiles where slug = s $$;
grant execute on function extensions.t_pid(text) to authenticated;
insert into auth.users (id, email, email_confirmed_at) values
(
 'aaaaaa37-0000-0000-0000-000000000001','u1@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000002','u2@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000003','u3@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000004','u4@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000005','u5@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000006','u6@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000007','u7@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000008','u8@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000009','u9@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000010','u10@x.test', now()),(
 'aaaaaa37-0000-0000-0000-000000000011','u11@x.test', now()),
('aaaaaa37-0000-0000-0000-000000000012','u12@x.test', now());
insert into organizations (id, type, name) values
 ('cccccc37-0000-0000-0000-000000000001','client_company','Client One'),('cccccc37-0000-0000-0000-000000000002','client_company','Client Two'),
 ('cccccc37-0000-0000-0000-000000000005','individual','Provider One'),('cccccc37-0000-0000-0000-000000000006','individual','Provider Two'),('cccccc37-0000-0000-0000-000000000008','individual','Provider Three'),
 ('cccccc37-0000-0000-0000-000000000009','agency','Agency Nine'),('cccccc37-0000-0000-0000-000000000010','individual','Provider Ten'),('cccccc37-0000-0000-0000-000000000011','individual','Provider Eleven');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa37-0000-0000-0000-000000000001','cccccc37-0000-0000-0000-000000000001','owner'),('aaaaaa37-0000-0000-0000-000000000002','cccccc37-0000-0000-0000-000000000001','admin'),('aaaaaa37-0000-0000-0000-000000000003','cccccc37-0000-0000-0000-000000000001','member'),('aaaaaa37-0000-0000-0000-000000000004','cccccc37-0000-0000-0000-000000000001','viewer'),
 ('aaaaaa37-0000-0000-0000-000000000005','cccccc37-0000-0000-0000-000000000005','owner'),('aaaaaa37-0000-0000-0000-000000000006','cccccc37-0000-0000-0000-000000000006','owner'),('aaaaaa37-0000-0000-0000-000000000007','cccccc37-0000-0000-0000-000000000002','owner'),('aaaaaa37-0000-0000-0000-000000000008','cccccc37-0000-0000-0000-000000000008','owner'),
 ('aaaaaa37-0000-0000-0000-000000000009','cccccc37-0000-0000-0000-000000000009','owner'),('aaaaaa37-0000-0000-0000-000000000010','cccccc37-0000-0000-0000-000000000010','owner'),('aaaaaa37-0000-0000-0000-000000000011','cccccc37-0000-0000-0000-000000000011','owner'),('aaaaaa37-0000-0000-0000-000000000012','cccccc37-0000-0000-0000-000000000005','viewer');
insert into provider_profiles (org_id, slug, headline, visibility, status, country, availability) values
 ('cccccc37-0000-0000-0000-000000000005','pool-p1','Designer One','public','active','AE','available'),
 ('cccccc37-0000-0000-0000-000000000006','pool-p2','Private Two','private','active',null,'available'),
 ('cccccc37-0000-0000-0000-000000000008','pool-p3','Hidden Three','public','hidden_by_admin',null,'available'),
 ('cccccc37-0000-0000-0000-000000000009','pool-p4','Agency Own','public','active',null,'available'),
 ('cccccc37-0000-0000-0000-000000000010','pool-p5','Dev Five','public','active',null,'limited'),
 ('cccccc37-0000-0000-0000-000000000011','pool-p6','Dev Six','public','active',null,'available');
insert into provider_credentials (profile_id, org_id, kind, title, issuer, status)
 select id, org_id, 'licence', 'Checked Licence', 'Board', 'checked' from provider_profiles where slug = 'pool-p1';
insert into projects (id, org_id, title, description, status) values
 ('dddddd37-0000-0000-0000-000000000001','cccccc37-0000-0000-0000-000000000001','Open project one','A long enough description','open'),
 ('dddddd37-0000-0000-0000-000000000002','cccccc37-0000-0000-0000-000000000001','Open project two','A long enough description','open'),
 ('dddddd37-0000-0000-0000-000000000003','cccccc37-0000-0000-0000-000000000001','Draft project','A long enough description','draft'),
 ('dddddd37-0000-0000-0000-000000000004','cccccc37-0000-0000-0000-000000000002','Other org project','A long enough description','open');
update platform_settings set value = '{"default":2}' where key in ('limits.talent_pools','limits.pool_members','limits.project_invites_per_day');

select is((select count(*)::int from platform_settings where key in ('limits.talent_pools','limits.pool_members','limits.project_invites_per_day')), 3, 'the migration inserts the three limits');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000001',true);
select throws_ok($$insert into talent_pools (org_id, name) values ('cccccc37-0000-0000-0000-000000000001','Direct')$$, '42501', null, 'pools cannot be written directly');
select throws_ok($$insert into talent_pool_members (pool_id, profile_id, org_id) select id, (select id from provider_profiles limit 1), org_id from talent_pools$$, '42501', null, 'members cannot be written directly');
select throws_ok($$insert into project_invitations (project_id, org_id, profile_id, message) values (gen_random_uuid(), 'cccccc37-0000-0000-0000-000000000001', gen_random_uuid(), 'a long message here')$$, '42501', null, 'invitations cannot be written directly');
select lives_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'Shortlist', 'My trusted people')$$, 'an owner creates a pool');
select lives_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'Backups', '')$$, 'and a second pool');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'Third', '')$$, '54000', null, 'the pool limit is enforced');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'shortlist', '')$$, '54000', null, 'limit is checked before duplicates here');
select lives_ok($$select pool_delete('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Backups'))$$, 'an owner deletes a pool');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'SHORTLIST', '')$$, '23505', null, 'pool names are unique per organization, case-insensitively');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'x', '')$$, '22023', null, 'a too-short name is refused');
select lives_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), 'Shortlist', 'Updated description')$$, 'an owner renames or edits a pool');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', gen_random_uuid(), 'Ghost', '')$$, '22023', null, 'editing a missing pool is refused');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000002', null, 'Cross', '')$$, '42501', null, 'an owner cannot create a pool in another organization');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000003',true);
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'Member pool', '')$$, '42501', null, 'a member cannot create pools');
select throws_ok($$select pool_delete('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'))$$, '42501', null, 'a member cannot delete pools');
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p1'), '  Great on past work  ', array['  Rust ','rust','Go'])$$, 'a member adds a professional');
select is((select tags from talent_pool_members limit 1), array['rust','go'], 'tags are trimmed, lower-cased and de-duplicated');
select is((select note from talent_pool_members limit 1), 'Great on past work', 'the note is trimmed');
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p1'), 'Changed', array['a'])$$, 'adding again updates the note and tags');
select is((select count(*)::int from talent_pool_members), 1, 'without creating a duplicate');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p2'), null, '{}')$$, '22023', null, 'a private profile cannot be added');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p3'), null, '{}')$$, '22023', null, 'a hidden profile cannot be added');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), gen_random_uuid(), null, '{}')$$, '22023', null, 'a missing profile is refused');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'), null, array['a','b','c','d','e','f','g','h','i','j','k'])$$, '22023', null, 'more than ten tags are refused');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'), null, array[repeat('x',31)])$$, '22023', null, 'a tag over 30 characters is refused');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'), repeat('n',1001), '{}')$$, '22023', null, 'a note over 1000 characters is refused');
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'), null, '{}')$$, 'a second professional fits the limit');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p6'), null, '{}')$$, '54000', null, 'the per-pool member limit is enforced');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', gen_random_uuid(), extensions.t_pid('pool-p6'), null, '{}')$$, '22023', null, 'a missing pool is refused');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000004',true);
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p6'), null, '{}')$$, '42501', null, 'a viewer cannot add');
select throws_ok($$select pool_remove_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p1'))$$, '42501', null, 'a viewer cannot remove');
select is((select count(*)::int from pool_members('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'))), 2, 'a viewer can read the pool');
select is((select checked_credentials::int from pool_members('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist')) where slug = 'pool-p1'), 1, 'with a count of checked credentials');
select is((select members::int from pools_overview('cccccc37-0000-0000-0000-000000000001')), 2, 'the overview counts visible members');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000007',true);
select throws_ok($$select * from pool_members('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'))$$, '42501', null, 'another organization cannot read the pool');
select throws_ok($$select * from pools_overview('cccccc37-0000-0000-0000-000000000001')$$, '42501', null, 'nor the overview');
select is((select count(*)::int from talent_pools) + (select count(*)::int from talent_pool_members), 0, 'nor the tables');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p6'), null, '{}')$$, '42501', null, 'nor write to it');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000005',true);
select is((select count(*)::int from talent_pools) + (select count(*)::int from talent_pool_members), 0, 'a professional cannot see which pools they are in');
select throws_ok($$select pool_save('cccccc37-0000-0000-0000-000000000005', null, 'Mine', '')$$, '22023', null, 'an individual provider organization cannot use pools');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000009',true);
select lives_ok($$select pool_save('cccccc37-0000-0000-0000-000000000009', null, 'Agency pool', '')$$, 'an agency can use pools');
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000009', (select id from talent_pools where name = 'Agency pool'), extensions.t_pid('pool-p4'), null, '{}')$$, '22023', null, 'an organization cannot add its own profile');
reset role;
update provider_profiles set visibility = 'private' where slug = 'pool-p5';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000001',true);
select is((select count(*)::int from pool_members('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'))), 1, 'a profile that turns private disappears from the pool view');
select is((select members::int from pools_overview('cccccc37-0000-0000-0000-000000000001') where name = 'Shortlist'), 1, 'and from the overview count');
reset role;
update provider_profiles set visibility = 'public' where slug = 'pool-p5';
set local role authenticated;

-- invitations
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000004',true);
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p1'), 'We would love your help')$$, '42501', null, 'a viewer cannot invite');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000003',true);
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p1'), 'short')$$, '22023', null, 'a short message is refused');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000003', extensions.t_pid('pool-p1'), 'We would love your help')$$, '22023', null, 'a draft project cannot invite');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000004', extensions.t_pid('pool-p1'), 'We would love your help')$$, '22023', null, 'another organization''s project cannot be used');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p6'), 'We would love your help')$$, '22023', null, 'a professional outside every pool cannot be invited');
select lives_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p1'), 'We would love your help')$$, 'a member invites a pool member to an open project');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p1'), 'We would love your help')$$, '23505', null, 'the same invitation cannot be sent twice');
select lives_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p5'), 'We would love your help')$$, 'a second invitation fits the daily cap');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000002', extensions.t_pid('pool-p1'), 'We would love your help')$$, '54000', null, 'the daily cap is enforced');
reset role;
select is((select count(*)::int from notifications where user_id = 'aaaaaa37-0000-0000-0000-000000000005' and type = 'project_invite' and payload->>'from' = 'Client One'), 1, 'the professional is notified, naming the organization');
select is((select count(*)::int from audit_log where action = 'project.invite' and org_id = 'cccccc37-0000-0000-0000-000000000001'), 2, 'invitations are audited');
update project_invitations set created_at = now() - interval '2 days' where profile_id = extensions.t_pid('pool-p5');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000003',true);
select lives_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000002', extensions.t_pid('pool-p1'), 'We would love your help')$$, 'invitations older than a day stop counting toward the cap');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000005',true);
select is((select count(*)::int from my_invitations('cccccc37-0000-0000-0000-000000000005')), 2, 'the professional sees their invitations');
select is((select from_org from my_invitations('cccccc37-0000-0000-0000-000000000005') where project_title = 'Open project one'), 'Client One', 'from the organization');
select is((select count(*)::int from project_invitations), 2, 'the professional can read their invitation rows');
select throws_ok($$select invited_by from project_invitations$$, '42501', null, 'but not who sent them');
select throws_ok($$select * from my_invitations('cccccc37-0000-0000-0000-000000000001')$$, '42501', null, 'nobody reads another organization''s inbox');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000006',true);
select is((select count(*)::int from project_invitations), 0, 'another professional sees none');
select throws_ok($$select invitation_decline('cccccc37-0000-0000-0000-000000000005', (select id from project_invitations limit 1))$$, '42501', null, 'and cannot decline for someone else');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000001',true);
select is((select count(*)::int from project_invitations), 3, 'the inviting organization sees what it sent');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000005',true);
select lives_ok($$select invitation_decline('cccccc37-0000-0000-0000-000000000005', (select id from project_invitations where project_id = 'dddddd37-0000-0000-0000-000000000001'))$$, 'the professional declines');
select throws_ok($$select invitation_decline('cccccc37-0000-0000-0000-000000000005', (select id from project_invitations where project_id = 'dddddd37-0000-0000-0000-000000000001'))$$, '22023', null, 'a second answer is refused');
select throws_ok($$select invitation_decline('cccccc37-0000-0000-0000-000000000005', gen_random_uuid())$$, '22023', null, 'a missing invitation is refused');
select is((select status from project_invitations where project_id = 'dddddd37-0000-0000-0000-000000000001'), 'declined', 'the status is recorded');
reset role;
update projects set status = 'closed' where id = 'dddddd37-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000005',true);
select is((select count(*)::int from my_invitations('cccccc37-0000-0000-0000-000000000005')), 1, 'invitations to closed projects leave the inbox');
reset role;
update organizations set status = 'suspended' where id = 'cccccc37-0000-0000-0000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000003',true);
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p5'), 'We would love your help')$$, '22023', null, 'a suspended organization''s professional cannot be invited');
select lives_ok($$select pool_remove_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'))$$, 'a member removes a professional');
select throws_ok($$select pool_remove_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'), extensions.t_pid('pool-p5'))$$, '22023', null, 'removing twice is refused');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000002',true);
select lives_ok($$select pool_delete('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Shortlist'))$$, 'an admin deletes the pool');
reset role;
select is((select count(*)::int from talent_pool_members where org_id = 'cccccc37-0000-0000-0000-000000000001'), 0, 'deleting a pool deletes its members');
select is((select count(*)::int from audit_log where action in ('pool.create','pool.delete') and org_id = 'cccccc37-0000-0000-0000-000000000001'), 4, 'pool creation and deletion are audited');

-- review fixes: hidden members free their slots, no self-dealing, viewers do not read invitations, no org row lock
reset role;
select ok(position('from organizations where id = p_org for update' in (select prosrc from pg_proc where proname = 'project_invite')) = 0
          and position('from organizations where id = p_org for update' in (select prosrc from pg_proc where proname = 'pool_save')) = 0,
          'inviting and creating pools take an advisory lock, not an organization row lock (avoids deadlock with hiring)');
update provider_profiles set visibility = 'public' where slug = 'pool-p5';
update organizations set status = 'active' where id = 'cccccc37-0000-0000-0000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000001',true);
select lives_ok($$select pool_save('cccccc37-0000-0000-0000-000000000001', null, 'Hidden test', '')$$, 'a new pool after the earlier one was deleted');
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Hidden test'), extensions.t_pid('pool-p1'), null, '{}')$$, 'first member');
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Hidden test'), extensions.t_pid('pool-p6'), null, '{}')$$, 'second member');
reset role;
update provider_profiles set visibility = 'private' where slug = 'pool-p6';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000001',true);
select lives_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Hidden test'), extensions.t_pid('pool-p4'), null, '{}')$$, 'a member who turned private no longer holds a slot');
reset role;
insert into memberships (user_id, org_id, role) values ('aaaaaa37-0000-0000-0000-000000000003','cccccc37-0000-0000-0000-000000000011','member');
update provider_profiles set visibility = 'public' where slug = 'pool-p6';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000003',true);
select throws_ok($$select pool_set_member('cccccc37-0000-0000-0000-000000000001', (select id from talent_pools where name = 'Hidden test'), extensions.t_pid('pool-p6'), null, '{}')$$, '22023', null, 'someone who belongs to both organizations cannot pool the other one');
select throws_ok($$select project_invite('cccccc37-0000-0000-0000-000000000001', 'dddddd37-0000-0000-0000-000000000001', extensions.t_pid('pool-p6'), 'We would love your help')$$, '22023', null, 'nor invite it');
select set_config('request.jwt.claim.sub','aaaaaa37-0000-0000-0000-000000000012',true);
select is((select count(*)::int from project_invitations), 0, 'a viewer of the professional''s organization cannot read invitations');
select throws_ok($$select * from my_invitations('cccccc37-0000-0000-0000-000000000005')$$, '42501', null, 'nor list them');
select * from finish();
rollback;

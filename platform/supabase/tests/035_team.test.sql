begin;
select plan(75);
create function extensions.t_rows_affected(q text) returns int language plpgsql as
$$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;

insert into auth.users (id, email, email_confirmed_at) values
 ('aaaaaa35-0000-0000-0000-0000000000a1','owner@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a2','admin@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a3','member@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a4','viewer@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a5','invitee@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a6','other@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a7','unconfirmed@x.test', null),
 ('aaaaaa35-0000-0000-0000-0000000000a8','stranger@x.test', now()),
 ('aaaaaa35-0000-0000-0000-0000000000a9','more@x.test', now());
insert into organizations (id, type, name) values
 ('cccccc35-0000-0000-0000-0000000000a1','agency','Org A'),('cccccc35-0000-0000-0000-0000000000b1','agency','Org B');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa35-0000-0000-0000-0000000000a1','cccccc35-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaa35-0000-0000-0000-0000000000a2','cccccc35-0000-0000-0000-0000000000a1','admin'),
 ('aaaaaa35-0000-0000-0000-0000000000a3','cccccc35-0000-0000-0000-0000000000a1','member'),
 ('aaaaaa35-0000-0000-0000-0000000000a4','cccccc35-0000-0000-0000-0000000000a1','viewer'),
 ('aaaaaa35-0000-0000-0000-0000000000a6','cccccc35-0000-0000-0000-0000000000b1','owner');
update platform_settings set value = '{"default":6}' where key = 'limits.team_seats';

-- the defaults come from the migration
select is((select count(*)::int from platform_settings where key in ('limits.team_seats','limits.team_invites_per_day')), 2, 'the migration inserts both team limits');
select is((select enabled from feature_flags where key = 'team.email_invites'), false, 'email invites are off by default');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);

-- memberships can no longer be written directly, by anyone signed in
select throws_ok($$insert into memberships (user_id, org_id, role) values ('aaaaaa35-0000-0000-0000-0000000000a8','cccccc35-0000-0000-0000-0000000000a1','member')$$, '42501', null, 'an owner cannot insert a membership directly');
select throws_ok($$update memberships set role = 'viewer' where user_id = 'aaaaaa35-0000-0000-0000-0000000000a3'$$, '42501', null, 'an owner cannot update a membership directly');
select throws_ok($$delete from memberships where user_id = 'aaaaaa35-0000-0000-0000-0000000000a3'$$, '42501', null, 'an owner cannot delete a membership directly');
select throws_ok($$insert into org_invites (org_id, email, role, token_hash, invited_by) values ('cccccc35-0000-0000-0000-0000000000a1','x@x.test','member',repeat('f',64),'aaaaaa35-0000-0000-0000-0000000000a1')$$, '42501', null, 'invites cannot be written directly');

-- reading the team
select is((select count(*)::int from team_members('cccccc35-0000-0000-0000-0000000000a1')), 4, 'a member sees the four members');
select is((select email from team_members('cccccc35-0000-0000-0000-0000000000a1') where role = 'admin'), 'admin@x.test', 'with their sign-in addresses');
select throws_ok($$select * from team_members('cccccc35-0000-0000-0000-0000000000b1')$$, '42501', null, 'another organization cannot be read');
select is((select team_seat_usage('cccccc35-0000-0000-0000-0000000000a1')), '{"members":4,"pending":0,"limit":6}'::jsonb, 'seat usage counts members and pending invites against the limit');

-- inviting: who may
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a3',true);
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','member',repeat('9',64))$$, '42501', null, 'a member cannot invite');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a4',true);
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','member',repeat('9',64))$$, '42501', null, 'a viewer cannot invite');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a8',true);
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','member',repeat('9',64))$$, '42501', null, 'an outsider cannot invite');

select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','Invitee@X.test','member',repeat('1',64))$$, 'an admin invites a member (address is lower-cased)');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','admin',repeat('9',64))$$, '42501', null, 'an admin cannot invite an admin');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','owner',repeat('9',64))$$, '22023', null, 'nobody is invited as owner');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','not an email','member',repeat('9',64))$$, '22023', null, 'a bad address is refused');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','x@x.test','member','short')$$, '22023', null, 'a malformed token hash is refused');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','INVITEE@x.test','member',repeat('9',64))$$, '23505', null, 'a second pending invite to the same address is refused');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','member@x.test','member',repeat('9',64))$$, '23505', null, 'an existing member cannot be invited');

-- seats: 4 members + pending against a limit of 6
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','adm@x.test','admin',repeat('2',64))$$, 'an owner invites an admin');
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','more@x.test','member',repeat('3',64))$$, '54000', null, 'pending invites count against the seat limit');
select lives_ok(format($f$select team_revoke_invite('cccccc35-0000-0000-0000-0000000000a1', %L)$f$, (select id from org_invites where email = 'adm@x.test')), 'an owner revokes an invite');
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','more@x.test','member',repeat('3',64))$$, 'a revoked invite frees its seat');
select throws_ok($$select token_hash from org_invites$$, '42501', null, 'the token hash is not readable by anyone signed in');
select is((select count(*)::int from org_invites where revoked_at is null and accepted_at is null), 2, 'an owner sees the pending invites');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a3',true);
select is((select count(*)::int from org_invites), 0, 'a member sees no invites');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select throws_ok(format($f$select team_revoke_invite('cccccc35-0000-0000-0000-0000000000b1', %L)$f$, (select id from org_invites where email = 'more@x.test')), '42501', null, 'an invite cannot be revoked through another organization');

-- accepting
reset role;
update platform_settings set value = '{"default":10}' where key = 'limits.team_seats';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','unconfirmed@x.test','member',repeat('4',64))$$, 'invite for an account that is not confirmed');
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','stranger@x.test','viewer',repeat('5',64))$$, 'invite for a later check');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a8',true);
select throws_ok($$select team_accept_invite(repeat('1',64))$$, '42501', null, 'a different account cannot use the link');
select throws_ok($$select team_invite_preview(repeat('1',64))$$, '42501', null, 'nor preview it');
select throws_ok($$select team_accept_invite(repeat('0',64))$$, '42501', null, 'an unknown token fails the same way');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a7',true);
select throws_ok($$select team_accept_invite(repeat('4',64))$$, '42501', null, 'an unconfirmed account cannot accept');
reset role;
update auth.users set email_confirmed_at = now() where id = 'aaaaaa35-0000-0000-0000-0000000000a7';
update org_invites set expires_at = now() - interval '1 second' where email = 'unconfirmed@x.test';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a7',true);
select throws_ok($$select team_accept_invite(repeat('4',64))$$, '42501', null, 'an expired invite cannot be accepted');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_revoke_invite('cccccc35-0000-0000-0000-0000000000a1', (select id from org_invites where email = 'more@x.test'))$$, 'revoke before use');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a9',true);
select throws_ok($$select team_accept_invite(repeat('3',64))$$, '42501', null, 'a revoked invite cannot be accepted');

-- the seat limit is checked again when accepting
reset role;
update platform_settings set value = '{"default":4}' where key = 'limits.team_seats';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a5',true);
select is((select team_invite_preview(repeat('1',64))->>'org_name'), 'Org A', 'the invitee previews the organization');
select throws_ok($$select team_accept_invite(repeat('1',64))$$, '54000', null, 'a full organization cannot take one more');
reset role;
update platform_settings set value = '{"default":10}' where key = 'limits.team_seats';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a5',true);
select is((select team_accept_invite(repeat('1',64))), 'cccccc35-0000-0000-0000-0000000000a1'::uuid, 'the invitee accepts with the matching account');
select is((select role from memberships where user_id = 'aaaaaa35-0000-0000-0000-0000000000a5'), 'member', 'and gets the invited role');
select throws_ok($$select team_accept_invite(repeat('1',64))$$, '42501', null, 'the link works once');

-- roles
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a3',true);
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a4','member')$$, '42501', null, 'a member cannot change roles');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a3','viewer')$$, 'an admin moves a member to viewer');
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a3','admin')$$, '42501', null, 'an admin cannot make an admin');
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a1','member')$$, '42501', null, 'an admin cannot touch an owner');
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a2','member')$$, '42501', null, 'an admin cannot demote an admin, including themselves');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a3','admin')$$, 'an owner makes an admin');
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a5','boss')$$, '22023', null, 'an unknown role is invalid');
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a8','member')$$, '22023', null, 'a person who is not a member cannot be given a role');
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a5','owner')$$, 'an owner promotes another owner');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a5',true);
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a5','member')$$, 'an owner steps down while another owner remains');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select throws_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a1','admin')$$, 'P0001', 'organization must keep at least one owner', 'the last owner cannot step down');

-- removing and leaving
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select throws_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a3')$$, '42501', null, 'an admin cannot remove an admin');
select throws_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a1')$$, '42501', null, 'an admin cannot remove an owner');
select lives_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a4')$$, 'an admin removes a viewer');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a4',true);
select throws_ok($$select * from team_members('cccccc35-0000-0000-0000-0000000000a1')$$, '42501', null, 'a removed member loses access at once');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select throws_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a1')$$, '22023', null, 'an owner uses Leave, not Remove, for themselves');
select lives_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a3')$$, 'an owner removes an admin');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a5',true);
select lives_ok($$select team_leave('cccccc35-0000-0000-0000-0000000000a1')$$, 'a member leaves');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select throws_ok($$select team_leave('cccccc35-0000-0000-0000-0000000000a1')$$, 'P0001', 'organization must keep at least one owner', 'the last owner cannot leave');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a8',true);
select throws_ok($$select team_leave('cccccc35-0000-0000-0000-0000000000a1')$$, '42501', null, 'a non-member cannot leave');

-- an invite does not outlive its inviter's authority
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a2','admin')$$, 'admin stays admin (no-op) before the invite');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','ghost1@x.test','member',repeat('7',64))$$, 'an admin invites someone');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a2','member')$$, 'the owner demotes that admin to member');
select is((select count(*)::int from org_invites where invited_by = 'aaaaaa35-0000-0000-0000-0000000000a2' and accepted_at is null and revoked_at is null), 0, 'the demoted admin pending invites are revoked');
select lives_ok($$select team_set_role('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a2','admin')$$, 'promoted again');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select lives_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','ghost2@x.test','member',repeat('8',64))$$, 'invites again');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select lives_ok($$select team_remove_member('cccccc35-0000-0000-0000-0000000000a1','aaaaaa35-0000-0000-0000-0000000000a2')$$, 'the owner removes that admin');
select is((select count(*)::int from org_invites where invited_by = 'aaaaaa35-0000-0000-0000-0000000000a2' and accepted_at is null and revoked_at is null), 0, 'a removed person leaves no live invites behind');

-- a suspended organization neither invites nor accepts
reset role;
update organizations set status = 'suspended' where id = 'cccccc35-0000-0000-0000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','new@x.test','member',repeat('6',64))$$, '55000', null, 'a suspended organization cannot invite');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a8',true);
select throws_ok($$select team_accept_invite(repeat('5',64))$$, '42501', null, 'or accept');
reset role;
update organizations set status = 'active' where id = 'cccccc35-0000-0000-0000-0000000000a1';

-- the daily invite cap
update platform_settings set value = '{"default":1}' where key = 'limits.team_invites_per_day';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a1',true);
select throws_ok($$select team_create_invite('cccccc35-0000-0000-0000-0000000000a1','new@x.test','member',repeat('6',64))$$, '54000', null, 'the daily invite cap holds');

-- signed-out callers cannot call any of it
reset role;
set local role anon;
select throws_ok($$select * from team_members('cccccc35-0000-0000-0000-0000000000a1')$$, '42501', null, 'anon cannot read the team');
select throws_ok($$select team_accept_invite(repeat('1',64))$$, '42501', null, 'anon cannot accept');

select * from finish();
rollback;

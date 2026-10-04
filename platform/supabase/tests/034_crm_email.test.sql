begin;
select plan(43);
insert into auth.users (id, email) values
 ('aaaaaa35-0000-0000-0000-0000000000a1','owner@x.test'),('aaaaaa35-0000-0000-0000-0000000000a2','member@x.test'),
 ('aaaaaa35-0000-0000-0000-0000000000a3','viewer@x.test'),('aaaaaa35-0000-0000-0000-0000000000a4','other@x.test'),
 ('aaaaaa35-0000-0000-0000-0000000000a5','admin@x.test'),('aaaaaa35-0000-0000-0000-0000000000a6','member2@x.test');
insert into organizations (id, type, name) values
 ('cccccc35-0000-0000-0000-0000000000a1','individual','Org A'),('cccccc35-0000-0000-0000-0000000000b1','agency','Org B');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa35-0000-0000-0000-0000000000a1','cccccc35-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaa35-0000-0000-0000-0000000000a2','cccccc35-0000-0000-0000-0000000000a1','member'),
 ('aaaaaa35-0000-0000-0000-0000000000a3','cccccc35-0000-0000-0000-0000000000a1','viewer'),
 ('aaaaaa35-0000-0000-0000-0000000000a6','cccccc35-0000-0000-0000-0000000000a1','member'),
 ('aaaaaa35-0000-0000-0000-0000000000a4','cccccc35-0000-0000-0000-0000000000b1','owner');
insert into platform_roles (user_id, role) values ('aaaaaa35-0000-0000-0000-0000000000a5','admin');
insert into crm_contacts (id, org_id, name, email) values
 ('dddddd35-0000-0000-0000-000000000001','cccccc35-0000-0000-0000-0000000000a1','Sara','Sara@Khan.test'),
 ('dddddd35-0000-0000-0000-000000000002','cccccc35-0000-0000-0000-0000000000a1','No Email',null),
 ('dddddd35-0000-0000-0000-000000000003','cccccc35-0000-0000-0000-0000000000b1','Other Org Contact','b@x.test'),
 ('dddddd35-0000-0000-0000-000000000004','cccccc35-0000-0000-0000-0000000000a1','Lee','lee@x.test');
insert into billing_profiles (org_id, legal_name, address, country) values ('cccccc35-0000-0000-0000-0000000000a1','Org A FZE LLC','Office 1, Dubai','AE');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);

-- basis
select lives_ok($$select crm_set_basis('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','existing_client')$$, 'a member records the basis');
select throws_ok($$select crm_set_basis('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','because')$$, '22023', null, 'an unknown basis is invalid');
select throws_ok($$select crm_set_basis('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000003','opted_in')$$, '42501', null, 'a contact of another organization cannot be changed');

-- the feature is off until the flag is on
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Hello','Body')$$, '55000', null, 'sending is refused while the flag is off');
reset role;
update feature_flags set enabled = true where key = 'crm.email';
select is((select enabled from feature_flags where key = 'crm.email'), true, 'the flag row exists (created by the migration) and is now on');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);

-- preconditions
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000004','Hello','Body')$$, '55000', null, 'a contact without a recorded basis cannot be emailed');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000002','Hello','Body')$$, '22023', null, 'a contact without an address cannot be emailed');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001',E'Hi\nBcc: x@y.test','Body')$$, '22023', null, 'a subject with a line break is refused (header injection)');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','','Body')$$, '22023', null, 'an empty subject is refused');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Hello','')$$, '22023', null, 'an empty body is refused');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000003','Hello','Body')$$, '42501', null, 'a contact of another organization cannot be emailed');

-- viewer and outsider
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a3',true);
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Hello','Body')$$, '42501', null, 'a viewer cannot send');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a4',true);
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Hello','Body')$$, '42501', null, 'another organization cannot send');

-- a good reservation
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
create temp table r (j jsonb);
grant all on r to authenticated, service_role;
insert into r select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Hello','Body text');
select is((select j->>'to' from r), 'Sara@Khan.test', 'the reservation returns the address');
select is((select j->>'legal_name' from r), 'Org A FZE LLC', 'and the sender identity for the footer');
select is((select j->>'basis' from r), 'existing_client', 'and the recorded basis');
select is((select status from crm_emails where id = (select (j->>'id')::uuid from r)), 'queued', 'the message is queued, not sent');

-- marking is done by the server, never by users (a user must not be able to turn a delivered message into a "failed" one)
select throws_ok($$select crm_mark_email((select (j->>'id')::uuid from r), 'failed', null)$$, '42501', null, 'a member cannot mark a message');
reset role;
set local role service_role;
select throws_ok($$select crm_mark_email((select (j->>'id')::uuid from r), 'weird', 'p1')$$, '22023', null, 'an unknown status is invalid');
select lives_ok($$select crm_mark_email((select (j->>'id')::uuid from r), 'sent', 'prov_1')$$, 'the server marks it sent');
select throws_ok($$select crm_mark_email((select (j->>'id')::uuid from r), 'failed', null)$$, '42501', null, 'a finished message cannot be re-marked');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);

-- the daily cap counts sent and queued, not failed
reset role;
update platform_settings set value = '{"default":2}' where key = 'limits.crm_emails_per_day';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
insert into r select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Second','Body');
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Third','Body')$$, '54000', null, 'the daily cap stops the third message');
reset role;
set local role service_role;
select lives_ok($$select crm_mark_email((select (j->>'id')::uuid from r offset 1 limit 1), 'failed', null)$$, 'the second message is refused by the provider');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
create temp table r3 (j jsonb);
grant all on r3 to authenticated, service_role;
insert into r3 select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Third','Body');
select is((select count(*)::int from r3), 1, 'a failed message does not use up the cap');
reset role;
set local role service_role;
select lives_ok($$select crm_mark_email((select (j->>'id')::uuid from r3), 'unknown', null)$$, 'an unconfirmed outcome can be recorded');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','Fourth','Body')$$, '54000', null, 'an unconfirmed message still counts toward the cap');

-- suppressions are not writable by users
select throws_ok($$insert into crm_emails (org_id, to_email, subject, body, basis) values ('cccccc35-0000-0000-0000-0000000000a1','a@b.test','s','b','opted_in')$$, '42501', null, 'users cannot insert message rows directly');
select throws_ok($$select crm_add_suppression('cccccc35-0000-0000-0000-0000000000a1','sara@khan.test','unsubscribe')$$, '42501', null, 'users cannot call the suppression function');

-- service role: unsubscribe and provider events
reset role;
set local role service_role;
select lives_ok($$select crm_add_suppression('cccccc35-0000-0000-0000-0000000000a1','SARA@khan.test','unsubscribe')$$, 'the service stores an unsubscribe (any case)');
select is((select crm_suppress_by_provider_id('prov_1','complaint')), true, 'a provider complaint is mapped to its message and address');
select is((select crm_suppress_by_provider_id('prov_unknown','bounce')), false, 'an unknown provider id changes nothing');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000001','After','Body')$$, '23P01', null, 'a suppressed address cannot be emailed again');

-- the basis belongs to the address it was recorded for
reset role;
insert into crm_contacts (id, org_id, name, email, basis) values ('dddddd35-0000-0000-0000-000000000005','cccccc35-0000-0000-0000-0000000000a1','Moves','old@x.test','opted_in');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select lives_ok($$select crm_save_contact('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000005','Moves',null,'old@x.test',null,'manual')$$, 'saving a contact without changing the address');
select is((select basis from crm_contacts where id = 'dddddd35-0000-0000-0000-000000000005'), 'opted_in', 'keeps the basis when the address is unchanged');
select lives_ok($$select crm_save_contact('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000005','Moves',null,'NEW@x.test',null,'manual')$$, 'changing the address');
select is((select basis from crm_contacts where id = 'dddddd35-0000-0000-0000-000000000005'), null, 'clears the basis when the address changes');
select lives_ok($$select crm_set_basis('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000005','requested_contact')$$, 'a basis is recorded again');
select is((select basis_set_by from crm_contacts where id = 'dddddd35-0000-0000-0000-000000000005'), 'aaaaaa35-0000-0000-0000-0000000000a2'::uuid, 'who recorded the basis is kept');
select isnt((select basis_set_at from crm_contacts where id = 'dddddd35-0000-0000-0000-000000000005'), null, 'and when');

-- stricter address check at send time
reset role;
insert into crm_contacts (id, org_id, name, email, basis) values ('dddddd35-0000-0000-0000-000000000006','cccccc35-0000-0000-0000-0000000000a1','Odd','x<a@b.co>','opted_in');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);
select throws_ok($$select crm_reserve_email('cccccc35-0000-0000-0000-0000000000a1','dddddd35-0000-0000-0000-000000000006','Hello','Body')$$, '22023', null, 'an address with brackets is not emailed');

-- provider ids are unique
reset role;
select throws_ok($$update crm_emails set provider_id = 'prov_1' where provider_id is null and org_id = 'cccccc35-0000-0000-0000-0000000000a1'$$, '23505', null, 'a provider id cannot belong to two messages');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a2',true);

-- visibility
select is((select count(*)::int from crm_emails where org_id = 'cccccc35-0000-0000-0000-0000000000a1'), 3, 'members read their organization''s message log');
select set_config('request.jwt.claim.sub','aaaaaa35-0000-0000-0000-0000000000a4',true);
select is((select count(*)::int from crm_emails) + (select count(*)::int from crm_suppressions), 0, 'another organization sees no messages or suppressions');
select * from finish();
rollback;

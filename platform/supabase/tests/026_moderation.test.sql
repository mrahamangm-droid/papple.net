begin;
select plan(16);
insert into auth.users (id, email) values
 ('aaaaaa26-0000-0000-0000-000000000001','user@x.test'),('aaaaaa26-0000-0000-0000-000000000002','support@x.test'),
 ('aaaaaa26-0000-0000-0000-000000000003','owner@x.test'),('aaaaaa26-0000-0000-0000-000000000004','reporter@x.test');
insert into platform_roles (user_id, role) values ('aaaaaa26-0000-0000-0000-000000000002','support');
insert into organizations (id, type, name) values ('cccccc26-0000-0000-0000-00000000000a','individual','Provider P'),('cccccc26-0000-0000-0000-00000000000c','client_company','Client C');
insert into memberships (user_id, org_id, role) values ('aaaaaa26-0000-0000-0000-000000000003','cccccc26-0000-0000-0000-00000000000a','owner'),('aaaaaa26-0000-0000-0000-000000000003','cccccc26-0000-0000-0000-00000000000c','owner');
insert into provider_profiles (id, org_id, slug, headline) values ('dddddd26-0000-0000-0000-000000000001','cccccc26-0000-0000-0000-00000000000a','prov-26','Provider headline 26');
insert into projects (id, org_id, title, description, currency, status, visibility) values ('eeeeee26-0000-0000-0000-000000000001','cccccc26-0000-0000-0000-00000000000c','Project title 26','Detailed description','USD','open','public');
insert into conversations (id, kind, ref_id, created_by) values ('11111126-0000-0000-0000-000000000001','profile','dddddd26-0000-0000-0000-000000000001','aaaaaa26-0000-0000-0000-000000000004');
insert into conversation_participants (conversation_id, org_id) values ('11111126-0000-0000-0000-000000000001','cccccc26-0000-0000-0000-00000000000a');
insert into messages (id, conversation_id, sender_user_id, sender_org_id, body) values ('22222226-0000-0000-0000-000000000001','11111126-0000-0000-0000-000000000001','aaaaaa26-0000-0000-0000-000000000004','cccccc26-0000-0000-0000-00000000000a','An abusive message body');
insert into content_reports (id, reporter_id, target_kind, target_id, reason, created_at) values
 ('33333326-0000-0000-0000-000000000001','aaaaaa26-0000-0000-0000-000000000004','profile','dddddd26-0000-0000-0000-000000000001','Spam profile', now() - interval '2 days'),
 ('33333326-0000-0000-0000-000000000002','aaaaaa26-0000-0000-0000-000000000001','profile','dddddd26-0000-0000-0000-000000000001','Also spam', now() - interval '1 day'),
 ('33333326-0000-0000-0000-000000000003','aaaaaa26-0000-0000-0000-000000000004','project','eeeeee26-0000-0000-0000-000000000001','Scam project', now()),
 ('33333326-0000-0000-0000-000000000004','aaaaaa26-0000-0000-0000-000000000004','message','22222226-0000-0000-0000-000000000001','Abuse', now());

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa26-0000-0000-0000-000000000001',true);
select throws_ok($$select * from moderation_queue()$$, '42501', null, 'a user cannot read the queue');
select set_config('request.jwt.claim.sub','aaaaaa26-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select * from moderation_queue()$$, '42501', null, 'staff without a second factor cannot read the queue');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select report_id::text from moderation_queue() limit 1), '33333326-0000-0000-0000-000000000001', 'the queue is oldest first');
select is((select open_count from moderation_queue() where report_id = '33333326-0000-0000-0000-000000000001'), 2, 'open_count counts reports on the same target');
select is((select target_label from moderation_queue() where target_kind = 'message'), 'An abusive message body', 'a message report shows the message text');
select is((select target_label from moderation_queue() where target_kind = 'project'), 'Project title 26', 'a project report shows the title');
select throws_ok($$select admin_set_visibility('profile','dddddd26-0000-0000-0000-000000000001',true,'short')$$, '22023', null, 'hiding needs a real reason');
select throws_ok($$select admin_set_visibility('profile','dddddd26-0000-0000-0000-000000000001',true,null)$$, '22023', null, 'hiding needs a reason at all');
select lives_ok($$select admin_set_visibility('profile','dddddd26-0000-0000-0000-000000000001',true,'Confirmed spam profile')$$, 'staff hides a profile');
select is((select status from content_reports where id = '33333326-0000-0000-0000-000000000002'), 'actioned', 'hiding actions the open reports on that target');
select is((select count(*)::int from hidden_items() where target_kind = 'profile'), 1, 'hidden_items lists the hidden profile');
select throws_ok($$select dismiss_report('33333326-0000-0000-0000-000000000003','short')$$, '22023', null, 'dismissing needs a real reason');
select lives_ok($$select dismiss_report('33333326-0000-0000-0000-000000000003','Reviewed, the project is genuine')$$, 'staff dismisses a report');
select throws_ok($$select dismiss_report('33333326-0000-0000-0000-000000000003','Dismissing the same report again')$$, '22023', null, 'a report is dismissed once');
select lives_ok($$select admin_set_visibility('profile','dddddd26-0000-0000-0000-000000000001',false,'Mistake, restoring the profile')$$, 'staff restores a profile');
reset role;
select is((select count(*)::int from audit_log where action in ('marketplace.hide','marketplace.unhide','moderation.dismiss') and after ->> 'reason' is not null), 3, 'hide, restore and dismiss are audited with reasons');
select * from finish();
rollback;

begin;
select plan(34);

insert into auth.users (id, email) values
 ('aaaaaa11-0000-0000-0000-000000000001','c1@x.test'),
 ('aaaaaa11-0000-0000-0000-000000000002','c2@x.test'),
 ('aaaaaa11-0000-0000-0000-000000000003','c3-viewer@x.test'),
 ('aaaaaa11-0000-0000-0000-000000000004','p1@x.test'),
 ('aaaaaa11-0000-0000-0000-000000000005','q1@x.test'),
 ('aaaaaa11-0000-0000-0000-000000000006','s1@x.test');
insert into organizations (id, type, name) values
 ('cccccc11-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc11-0000-0000-0000-00000000000a','individual','Provider P'),
 ('cccccc11-0000-0000-0000-00000000000b','agency','Agency Q');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa11-0000-0000-0000-000000000001','cccccc11-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa11-0000-0000-0000-000000000002','cccccc11-0000-0000-0000-00000000000c','member'),
 ('aaaaaa11-0000-0000-0000-000000000003','cccccc11-0000-0000-0000-00000000000c','viewer'),
 ('aaaaaa11-0000-0000-0000-000000000004','cccccc11-0000-0000-0000-00000000000a','owner'),
 ('aaaaaa11-0000-0000-0000-000000000005','cccccc11-0000-0000-0000-00000000000b','owner');
insert into provider_profiles (id, org_id, slug, headline) values
 ('dddddd11-0000-0000-0000-000000000001','cccccc11-0000-0000-0000-00000000000a','provider-p','Provider P headline');
insert into services (id, org_id, slug, title, status) values
 ('dddddd11-0000-0000-0000-000000000002','cccccc11-0000-0000-0000-00000000000a','svc-p','Service by P','published');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee11-0000-0000-0000-000000000001','cccccc11-0000-0000-0000-00000000000c','Open project','Detailed description','USD','open','public');

set local role anon;
select throws_ok($$select * from conversations$$, '42501', null, 'anon cannot read conversations');
select throws_ok($$select * from messages$$, '42501', null, 'anon cannot read messages');
select throws_ok($$select * from notifications$$, '42501', null, 'anon cannot read notifications');
reset role; set local role authenticated;

-- start a conversation about a service
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000001',true);
select lives_ok($$select start_conversation('cccccc11-0000-0000-0000-00000000000c','service','dddddd11-0000-0000-0000-000000000002','Hello, are you available in March?')$$, 'client starts a conversation about a service');
select is((select count(*) from conversation_participants)::int, 2, 'thread has both organizations');
select is((select start_conversation('cccccc11-0000-0000-0000-00000000000c','service','dddddd11-0000-0000-0000-000000000002','Following up')), (select id from conversations limit 1), 'starting the same thread again reuses it');
select is((select count(*) from messages)::int, 2, 'both messages are stored in the one thread');
select throws_ok($$select start_conversation('cccccc11-0000-0000-0000-00000000000c','service','dddddd11-0000-0000-0000-000000000002','   ')$$, '22023', null, 'blank first message refused');

-- start rules
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
select throws_ok($$select start_conversation('cccccc11-0000-0000-0000-00000000000a','service','dddddd11-0000-0000-0000-000000000002','talking to myself')$$, '22023', null, 'cannot message your own organization');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000006',true);
select throws_ok($$select start_conversation('cccccc11-0000-0000-0000-00000000000c','service','dddddd11-0000-0000-0000-000000000002','not my org')$$, '42501', null, 'cannot start as an org you do not belong to');
select is((select count(*) from conversations)::int, 0, 'stranger sees no conversations');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000005',true);
select is((select count(*) from messages)::int, 0, 'uninvolved org sees no messages');

-- sending
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
select is((select count(*) from messages)::int, 2, 'recipient org member reads the thread');
select lives_ok($$select send_message((select id from conversations limit 1),'cccccc11-0000-0000-0000-00000000000a','Yes, March works.')$$, 'recipient replies');
select throws_ok($$select send_message((select id from conversations limit 1),'cccccc11-0000-0000-0000-00000000000a','   ')$$, '22023', null, 'whitespace-only message refused');
select throws_ok($$select send_message((select id from conversations limit 1),'cccccc11-0000-0000-0000-00000000000a',repeat('a',4001))$$, '22023', null, '4001 chars refused');
select lives_ok($$select send_message((select id from conversations limit 1),'cccccc11-0000-0000-0000-00000000000a',repeat('a',4000))$$, '4000 chars accepted');
select throws_ok($$insert into messages (conversation_id, sender_user_id, sender_org_id, body) select id, auth.uid(), 'cccccc11-0000-0000-0000-00000000000a', 'direct' from conversations$$, '42501', null, 'direct message insert refused');
select throws_ok($$insert into notifications (user_id, type) values ('aaaaaa11-0000-0000-0000-000000000001','forged')$$, '42501', null, 'direct notification insert refused');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000003',true);
select throws_ok($$select send_message((select id from conversations limit 1),'cccccc11-0000-0000-0000-00000000000c','viewer speaking')$$, '42501', null, 'viewer role cannot send');
select is((select count(*) from messages)::int, 4, 'viewer can read the thread');

-- notifications
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
select is((select count(*) from notifications where type='message_received')::int, 2, 'provider notified of the two client messages');
select ok((select bool_and(char_length(payload->>'preview') <= 80) from notifications where type='message_received'), 'preview is capped at 80 characters');
select lives_ok($$select mark_notification_read((select id from notifications limit 1))$$, 'user marks own notification read');
reset role;
create temp table pn as select id from notifications where user_id='aaaaaa11-0000-0000-0000-000000000004' limit 1;
grant select on pn to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000001',true);
select throws_ok($$select mark_notification_read((select id from pn))$$, '42501', null, 'cannot mark someone elses notification');
select is((select count(*) from notifications where type='message_received')::int, 2, 'client is notified of the provider replies only');

-- proposal events
reset role;
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
set local role authenticated;
select lives_ok($$select submit_proposal('cccccc11-0000-0000-0000-00000000000a','eeeeee11-0000-0000-0000-000000000001','Offer',1000,'USD',7)$$, 'provider submits a proposal');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000002',true);
select is((select count(*) from notifications where type='proposal_received')::int, 1, 'client team member is notified of the proposal');
select is((select array_agg(k order by k) from (select jsonb_object_keys(payload) k from notifications where type='proposal_received') x), array['project_id','proposal_id'], 'proposal notification carries ids only');

-- decisions and closure notify the proposer
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000001',true);
select lives_ok($$select set_proposal_status((select id from proposals limit 1),'shortlisted')$$, 'client shortlists the proposal');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
select is((select count(*) from notifications where type='proposal_status')::int, 1, 'proposer is notified of the decision');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000001',true);
select lives_ok($$select set_project_status('cccccc11-0000-0000-0000-00000000000c','eeeeee11-0000-0000-0000-000000000001','closed')$$, 'client closes the project');
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000004',true);
select is((select count(*) from notifications where type='project_closed')::int, 1, 'proposer is notified when the project closes');

-- daily conversation limit (setting)
reset role;
update platform_settings set value='1'::jsonb where key='limits.new_conversations_per_day';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa11-0000-0000-0000-000000000001',true);
select throws_ok($$select start_conversation('cccccc11-0000-0000-0000-00000000000c','profile','dddddd11-0000-0000-0000-000000000001','A second new thread today')$$, '54000', null, 'daily new-conversation limit enforced');

select * from finish();
rollback;

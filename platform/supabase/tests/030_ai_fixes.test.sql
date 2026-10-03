begin;
select plan(5);
insert into auth.users (id, email) values ('aaaaaa30-0000-0000-0000-000000000001','member@x.test');
insert into organizations (id, type, name) values ('cccccc30-0000-0000-0000-00000000000a','individual','Org A');
insert into memberships (user_id, org_id, role) values ('aaaaaa30-0000-0000-0000-000000000001','cccccc30-0000-0000-0000-00000000000a','owner');
update feature_flags set enabled = true where key = 'ai.assistant';
update platform_settings set value = '{"free":2}' where key = 'ai.monthly_message_limits';
update platform_settings set value = 'null'::jsonb where key = 'ai.daily_request_cap';
-- two abandoned reservations from ten minutes ago must not hold the allowance
insert into ai_usage (user_id, org_id, feature, outcome, created_at) values
 ('aaaaaa30-0000-0000-0000-000000000001','cccccc30-0000-0000-0000-00000000000a','proposal_draft','reserved', now() - interval '10 minutes'),
 ('aaaaaa30-0000-0000-0000-000000000001','cccccc30-0000-0000-0000-00000000000a','proposal_draft','reserved', now() - interval '9 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa30-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{}',true);
select lives_ok($$select ai_reserve('cccccc30-0000-0000-0000-00000000000a','proposal_draft')$$, 'abandoned reservations no longer count against the allowance');
select lives_ok($$select ai_reserve('cccccc30-0000-0000-0000-00000000000a','proposal_draft')$$, 'a second fresh reservation fits the limit of two');
select throws_ok($$select ai_reserve('cccccc30-0000-0000-0000-00000000000a','proposal_draft')$$, '54000', null, 'fresh reservations still count');

reset role;
delete from ai_usage where created_at > now() - interval '1 minute';
update platform_settings set value = 'null'::jsonb where key = 'ai.monthly_message_limits';
insert into ai_usage (user_id, org_id, feature, outcome, created_at)
  select 'aaaaaa30-0000-0000-0000-000000000001','cccccc30-0000-0000-0000-00000000000a','proposal_draft','ok', now() - interval '20 seconds' from generate_series(1,10);
set local role authenticated;
select throws_ok($$select ai_reserve('cccccc30-0000-0000-0000-00000000000a','proposal_draft')$$, '54000', null, 'a user is limited to 10 reservations a minute even when called directly');

reset role;
delete from ai_usage;
delete from platform_settings where key = 'ai.monthly_message_limits';
set local role authenticated;
select throws_ok($$select ai_reserve('cccccc30-0000-0000-0000-00000000000a','proposal_draft')$$, '54000', null, 'a missing allowance setting fails closed');
select * from finish();
rollback;

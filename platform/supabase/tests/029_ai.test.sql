begin;
select plan(17);
insert into auth.users (id, email) values
 ('aaaaaa29-0000-0000-0000-000000000001','member@x.test'),('aaaaaa29-0000-0000-0000-000000000002','outsider@x.test'),
 ('aaaaaa29-0000-0000-0000-000000000003','admin@x.test'),('aaaaaa29-0000-0000-0000-000000000004','support@x.test');
insert into platform_roles (user_id, role) values ('aaaaaa29-0000-0000-0000-000000000003','admin'),('aaaaaa29-0000-0000-0000-000000000004','support');
insert into organizations (id, type, name) values ('cccccc29-0000-0000-0000-00000000000a','individual','Org A'),('cccccc29-0000-0000-0000-00000000000b','individual','Org B');
insert into memberships (user_id, org_id, role) values ('aaaaaa29-0000-0000-0000-000000000001','cccccc29-0000-0000-0000-00000000000a','owner');
update platform_settings set value = '{"free":2}' where key = 'ai.monthly_message_limits';

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa29-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000a','proposal_draft')$$, '42501', null, 'refused while the flag is off');

reset role;
update feature_flags set enabled = true where key = 'ai.assistant';
set local role authenticated;
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000a','write_a_novel')$$, '22023', null, 'unknown feature is invalid');
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000b','proposal_draft')$$, '42501', null, 'a non-member cannot reserve for another organization');

reset role;
insert into feature_flag_overrides (key, org_id, enabled) values ('ai.assistant','cccccc29-0000-0000-0000-00000000000a',false);
set local role authenticated;
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000a','proposal_draft')$$, '42501', null, 'a per-organization override of off wins over the global flag');
reset role;
delete from feature_flag_overrides where key = 'ai.assistant';
set local role authenticated;

select set_config('t.r1', ai_reserve('cccccc29-0000-0000-0000-00000000000a','proposal_draft')::text, true);
select isnt(current_setting('t.r1'), '', 'a member reserves');
select lives_ok($$select ai_finish(current_setting('t.r1')::uuid, 10, 20, 'ok')$$, 'the owner finishes a reservation');
select throws_ok($$select ai_finish(current_setting('t.r1')::uuid, 10, 20, 'ok')$$, '22023', null, 'finishing twice is refused');
select set_config('t.r2', ai_reserve('cccccc29-0000-0000-0000-00000000000a','polish_profile')::text, true);
select lives_ok($$select ai_finish(current_setting('t.r2')::uuid, 5, 0, 'error')$$, 'a failed call is recorded as error');
select set_config('t.r3', ai_reserve('cccccc29-0000-0000-0000-00000000000a','improve_brief')::text, true);
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000a','polish_service')$$, '54000', null, 'the monthly allowance is enforced and the failed call did not use any');

select set_config('request.jwt.claim.sub','aaaaaa29-0000-0000-0000-000000000002',true);
select throws_ok($$select ai_finish(current_setting('t.r3')::uuid, 1, 1, 'ok')$$, '42501', null, 'someone else cannot finish a reservation');

reset role;
select is((select tokens_in from ai_usage where id = current_setting('t.r1')::uuid), 10, 'tokens are recorded');
update platform_settings set value = 'null'::jsonb where key = 'ai.monthly_message_limits';
insert into platform_settings (key, value) values ('ai.daily_request_cap','2') on conflict (key) do update set value = '2'::jsonb;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa29-0000-0000-0000-000000000001',true);
select throws_ok($$select ai_reserve('cccccc29-0000-0000-0000-00000000000a','proposal_draft')$$, '54000', null, 'the global daily cap is enforced');

select throws_ok($$select count(*) from ai_usage$$, '42501', null, 'users cannot read the usage table');
select throws_ok($$select * from ai_usage_summary(30)$$, '42501', null, 'a user cannot read the summary');
select set_config('request.jwt.claim.sub','aaaaaa29-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select * from ai_usage_summary(30)$$, '42501', null, 'support staff cannot read the summary (admin only)');
select set_config('request.jwt.claim.sub','aaaaaa29-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select * from ai_usage_summary(30)$$, '42501', null, 'an admin without a second factor cannot read the summary');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select ok((select count(*) from ai_usage_summary(1000)) > 0, 'an admin with aal2 reads the summary (days are clamped)');
select * from finish();
rollback;

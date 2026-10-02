begin;
select plan(24);
insert into auth.users (id, email) values
 ('aaaaaa22-0000-0000-0000-000000000001','user@x.test'),('aaaaaa22-0000-0000-0000-000000000005','support@x.test'),('aaaaaa22-0000-0000-0000-000000000007','admin@x.test');
insert into platform_roles (user_id, role) values ('aaaaaa22-0000-0000-0000-000000000005','support'),('aaaaaa22-0000-0000-0000-000000000007','admin');
insert into platform_settings (key, value, description) values ('test.num','5','n'),('test.obj','{"a":1}','o') on conflict (key) do nothing;
insert into feature_flags (key, enabled, description) values ('test.flag', false, 'f') on conflict (key) do nothing;
insert into plans (key, name, audience, price_cents, currency, interval, stripe_price_id, limits, features, sort) values ('test_plan','Test','professional',500,'USD','month','price_x','{}','{}',99) on conflict (key) do nothing;

-- anonymous
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select admin_set_setting('test.num','6','a valid reason here')$$, '42501', null, 'anonymous cannot set a setting');
-- plain user
select set_config('request.jwt.claim.sub','aaaaaa22-0000-0000-0000-000000000001',true);
select throws_ok($$select admin_set_setting('test.num','6','a valid reason here')$$, '42501', null, 'a user cannot set a setting');
select throws_ok($$select admin_set_flag('test.flag', true, 'a valid reason here')$$, '42501', null, 'a user cannot set a flag');
-- support
select set_config('request.jwt.claim.sub','aaaaaa22-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select admin_set_setting('test.num','6','a valid reason here')$$, '42501', null, 'support cannot set a setting');
select throws_ok($$select admin_update_plan('test_plan','T',1,true,'{}','{}','a valid reason here')$$, '42501', null, 'support cannot edit a plan');
-- admin without aal2
select set_config('request.jwt.claim.sub','aaaaaa22-0000-0000-0000-000000000007',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select admin_set_setting('test.num','6','a valid reason here')$$, '42501', null, 'admin without a second factor is refused (setting)');
select throws_ok($$select admin_set_flag('test.flag', true, 'a valid reason here')$$, '42501', null, 'admin without a second factor is refused (flag)');
select throws_ok($$select admin_update_plan('test_plan','T',1,true,'{}','{}','a valid reason here')$$, '42501', null, 'admin without a second factor is refused (plan)');
-- admin with aal2
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select admin_set_setting('test.num','6','short')$$, '22023', null, 'a short reason is refused');
select throws_ok($$select admin_set_setting('no.such.key','6','a valid reason here')$$, '22023', null, 'an unknown setting is refused');
select throws_ok($$select admin_set_setting('test.num','"six"','a valid reason here')$$, '22023', null, 'a value of another JSON type is refused');
select lives_ok($$select admin_set_setting('test.num','6','Raising the number for a test')$$, 'admin with aal2 sets a setting');
select throws_ok($$select admin_set_flag('no.such.flag', true, 'a valid reason here')$$, '22023', null, 'an unknown flag is refused');
select lives_ok($$select admin_set_flag('test.flag', true, 'Enabling the flag for a test')$$, 'admin with aal2 sets a flag');
select throws_ok($$select admin_update_plan('test_plan','T',-1,true,'{}','{}','a valid reason here')$$, '22023', null, 'a negative price is refused');
select throws_ok($$select admin_update_plan('test_plan','T',1,true,'[1]','{}','a valid reason here')$$, '22023', null, 'limits must be a JSON object');
select throws_ok($$select admin_update_plan('no_plan','T',1,true,'{}','{}','a valid reason here')$$, '22023', null, 'an unknown plan is refused');
select lives_ok($$select admin_update_plan('test_plan','Renamed',900,false,'{"x":1}','{"y":true}','Repricing for a test')$$, 'admin with aal2 edits a plan');
reset role;
select is((select value::text from platform_settings where key = 'test.num'), '6', 'the setting changed');
select is((select old_value::text || '>' || new_value::text || '>' || changed_by::text from settings_history where key = 'test.num' order by id desc limit 1), '5>6>aaaaaa22-0000-0000-0000-000000000007', 'history records old, new and who');
select is((select count(*)::int from audit_log where action = 'admin.setting.set' and entity_id = 'test.num' and after ->> 'reason' = 'Raising the number for a test'), 1, 'the setting change is audited with its reason');
select is((select enabled from feature_flags where key = 'test.flag'), true, 'the flag changed');
select is((select name || '/' || price_cents || '/' || active || '/' || stripe_price_id || '/' || audience || '/' || interval from plans where key = 'test_plan'), 'Renamed/900/false/price_x/professional/month', 'the plan changed only the listed columns');
select is((select count(*)::int from audit_log where action in ('admin.flag.set','admin.plan.update') and after ->> 'reason' is not null), 2, 'flag and plan changes are audited');
select * from finish();
rollback;

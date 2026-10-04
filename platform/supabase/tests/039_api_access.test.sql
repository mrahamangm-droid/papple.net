begin;
select plan(81);
insert into auth.users (id, email, email_confirmed_at) values
('aaaaaa39-0000-0000-0000-000000000001','u1@x.test', now()),('aaaaaa39-0000-0000-0000-000000000002','u2@x.test', now()),('aaaaaa39-0000-0000-0000-000000000003','u3@x.test', now()),
('aaaaaa39-0000-0000-0000-000000000004','u4@x.test', now()),('aaaaaa39-0000-0000-0000-000000000005','u5@x.test', now()),('aaaaaa39-0000-0000-0000-000000000006','u6@x.test', now());
insert into organizations (id, type, name) values
 ('cccccc39-0000-0000-0000-000000000001','client_company','Client One'),('cccccc39-0000-0000-0000-000000000002','client_company','Client Two'),
 ('cccccc39-0000-0000-0000-000000000005','individual','Provider One'),('cccccc39-0000-0000-0000-000000000006','individual','Provider Two');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa39-0000-0000-0000-000000000001','cccccc39-0000-0000-0000-000000000001','owner'),('aaaaaa39-0000-0000-0000-000000000002','cccccc39-0000-0000-0000-000000000001','admin'),('aaaaaa39-0000-0000-0000-000000000003','cccccc39-0000-0000-0000-000000000001','member'),
 ('aaaaaa39-0000-0000-0000-000000000004','cccccc39-0000-0000-0000-000000000002','owner'),('aaaaaa39-0000-0000-0000-000000000005','cccccc39-0000-0000-0000-000000000005','owner'),('aaaaaa39-0000-0000-0000-000000000006','cccccc39-0000-0000-0000-000000000006','owner');
-- five projects for Client One (newest first: p5 .. p1; p1 is a draft), one for Client Two
insert into projects (id, org_id, title, description, status, budget_min, budget_max, currency, created_at) values
 ('eeeeee39-0000-0000-0000-000000000001','cccccc39-0000-0000-0000-000000000001','Project one draft','A long enough description','draft', null, null, 'USD', now() - interval '5 days'),
 ('eeeeee39-0000-0000-0000-000000000002','cccccc39-0000-0000-0000-000000000001','Project two open','A long enough description','open', 1000, 2000, 'USD', now() - interval '4 days'),
 ('eeeeee39-0000-0000-0000-000000000003','cccccc39-0000-0000-0000-000000000001','Project three open','A long enough description','open', 500, 900, 'EUR', now() - interval '3 days'),
 ('eeeeee39-0000-0000-0000-000000000004','cccccc39-0000-0000-0000-000000000001','Project four closed','A long enough description','closed', null, null, 'USD', now() - interval '2 days'),
 ('eeeeee39-0000-0000-0000-000000000005','cccccc39-0000-0000-0000-000000000001','Project five open','A long enough description','open', 100, 200, 'USD', now() - interval '1 day'),
 ('eeeeee39-0000-0000-0000-000000000099','cccccc39-0000-0000-0000-000000000002','Project other org','A long enough description','open', 1, 2, 'USD', now() - interval '1 day');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff39-0000-0000-0000-000000000001','eeeeee39-0000-0000-0000-000000000002','cccccc39-0000-0000-0000-000000000005','SECRET COVER LETTER',1000,'USD',7,'submitted'),
 ('ffffff39-0000-0000-0000-000000000002','eeeeee39-0000-0000-0000-000000000002','cccccc39-0000-0000-0000-000000000006','SECRET COVER LETTER',1100,'USD',7,'shortlisted'),
 ('ffffff39-0000-0000-0000-000000000003','eeeeee39-0000-0000-0000-000000000003','cccccc39-0000-0000-0000-000000000005','SECRET COVER LETTER',500,'EUR',7,'hired'),
 ('ffffff39-0000-0000-0000-000000000099','eeeeee39-0000-0000-0000-000000000099','cccccc39-0000-0000-0000-000000000005','SECRET COVER LETTER',1,'USD',7,'submitted');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('99999939-0000-0000-0000-000000000003','eeeeee39-0000-0000-0000-000000000003','ffffff39-0000-0000-0000-000000000003','cccccc39-0000-0000-0000-000000000001','cccccc39-0000-0000-0000-000000000005','Contract three',50000,'EUR',500,200,'active'),
 ('99999939-0000-0000-0000-000000000099','eeeeee39-0000-0000-0000-000000000099','ffffff39-0000-0000-0000-000000000099','cccccc39-0000-0000-0000-000000000002','cccccc39-0000-0000-0000-000000000005','Contract other',77777,'USD',500,200,'active');

select is((select count(*)::int from platform_settings where key = 'limits.api_keys'), 1, 'the migration inserts the API key limit');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'org_analytics_compute'), 1, 'the analytics computation is its own function');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select throws_ok($$select * from api_keys$$, '42501', null, 'a client cannot read the key table directly');
-- the free/default plan has no API keys until the limit says so
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Reporting', 'abcd1234', repeat('a',64))$$, '54000', null, 'a plan whose limit is zero cannot create a key');
reset role;
update platform_settings set value = '{"default":2}' where key = 'limits.api_keys';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select lives_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','  Reporting  ', 'abcd1234', repeat('a',64))$$, 'an owner can create a key');
select is((select name from api_keys_list('cccccc39-0000-0000-0000-000000000001') where prefix = 'abcd1234'), 'Reporting', 'the name is trimmed');
select lives_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Second', 'efgh5678', repeat('b',64))$$, 'a second key fits the limit of two');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Third', 'ijkl9012', repeat('c',64))$$, '54000', null, 'a third active key is over the limit');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Dup', 'mnop3456', repeat('b',64))$$, '54000', null, 'the limit is checked before the duplicate hash');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','', 'ijkl9012', repeat('c',64))$$, '22023', null, 'an empty name is invalid');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001', repeat('n',61), 'ijkl9012', repeat('c',64))$$, '22023', null, 'a 61 character name is invalid');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Bad prefix', 'short', repeat('c',64))$$, '22023', null, 'a malformed prefix is invalid');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Bad hash', 'ijkl9012', repeat('C',64))$$, '22023', null, 'an uppercase hash is invalid');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Bad hash', 'ijkl9012', repeat('c',63))$$, '22023', null, 'a short hash is invalid');
select is((select count(*)::int from api_keys_list('cccccc39-0000-0000-0000-000000000001')), 2, 'the list shows both keys');
reset role;
create temp table t_ids as select prefix, id from api_keys;
grant select on t_ids to authenticated, service_role;
select is((select count(*)::int from information_schema.columns where table_name = 'api_keys' and column_name = 'key_hash'), 1, 'the hash column exists in the table');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select is((select count(*)::int from jsonb_object_keys((select to_jsonb(k) from api_keys_list('cccccc39-0000-0000-0000-000000000001') k limit 1)) where jsonb_object_keys = 'key_hash'), 0, 'but the list never returns it');

-- who may manage keys
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000002',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Admin', 'qrst7890', repeat('d',64))$$, '42501', null, 'an admin cannot create a key');
select throws_ok($$select api_keys_list('cccccc39-0000-0000-0000-000000000001')$$, '42501', null, 'an admin cannot list keys');
select throws_ok($$select api_key_revoke('cccccc39-0000-0000-0000-000000000001', (select id from t_ids where prefix = 'abcd1234'))$$, '42501', null, 'an admin cannot revoke a key');
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000003',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Member', 'qrst7890', repeat('d',64))$$, '42501', null, 'a member cannot create a key');
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000004',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Outsider', 'qrst7890', repeat('d',64))$$, '42501', null, 'the owner of another organization cannot create a key here');
select throws_ok($$select api_keys_list('cccccc39-0000-0000-0000-000000000001')$$, '42501', null, 'and cannot list its keys');
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000005',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000005','Provider', 'qrst7890', repeat('d',64))$$, '22023', null, 'an individual provider organization has no API access');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Anon', 'qrst7890', repeat('d',64))$$, '42501', null, 'without a session nothing is created');

-- service side: authenticate
set local role service_role;
select is(api_key_authenticate(repeat('a',64)), 'cccccc39-0000-0000-0000-000000000001'::uuid, 'a valid key resolves to its organization');
select is(api_key_authenticate(repeat('f',64)), null, 'an unknown key resolves to nothing');
select is(api_key_authenticate('not-a-hash'), null, 'a malformed hash resolves to nothing');
reset role;
select isnt((select last_used_at from api_keys where prefix = 'abcd1234'), null, 'using a key stamps last_used_at');
select is((select last_used_at from api_keys where prefix = 'efgh5678'), null, 'an unused key has no last_used_at');
update api_keys set last_used_at = now() - interval '30 seconds' where prefix = 'abcd1234';
create temp table t_stamp as select last_used_at as ts from api_keys where prefix = 'abcd1234';
set local role service_role;
select api_key_authenticate(repeat('a',64));
reset role;
select is((select last_used_at from api_keys where prefix = 'abcd1234'), (select ts from t_stamp), 'a second call within a minute does not write again');
-- stamps again once it is a minute old
update api_keys set last_used_at = now() - interval '2 minutes' where prefix = 'abcd1234';
set local role service_role;
select api_key_authenticate(repeat('a',64));
reset role;
select ok((select last_used_at from api_keys where prefix = 'abcd1234') > now() - interval '1 minute', 'a stale stamp is refreshed');

-- revoke
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000004',true);
select throws_ok($$select api_key_revoke('cccccc39-0000-0000-0000-000000000002', (select id from t_ids where prefix = 'abcd1234'))$$, '22023', null, 'a key of another organization cannot be revoked through my own');
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select lives_ok($$select api_key_revoke('cccccc39-0000-0000-0000-000000000001', (select id from t_ids where prefix = 'abcd1234'))$$, 'the owner can revoke a key');
select isnt((select revoked_at from api_keys_list('cccccc39-0000-0000-0000-000000000001') where prefix = 'abcd1234'), null, 'the list shows it as revoked');
reset role;
create temp table t_rev as select revoked_at as ts from api_keys where prefix = 'abcd1234';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select lives_ok($$select api_key_revoke('cccccc39-0000-0000-0000-000000000001', (select id from t_ids where prefix = 'abcd1234'))$$, 'revoking twice is harmless');
reset role;
select is((select revoked_at from api_keys where prefix = 'abcd1234'), (select ts from t_rev), 'and keeps the first revocation time');
select is((select count(*)::int from audit_log where action = 'api_key.revoke' and org_id = 'cccccc39-0000-0000-0000-000000000001'), 1, 'only the first revocation is audited');
set local role service_role;
select is(api_key_authenticate(repeat('a',64)), null, 'a revoked key never authenticates again');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Reused hash', 'yzab5678', repeat('b',64))$$, '23505', null, 'a hash that already exists cannot be registered again');
select lives_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Replacement', 'uvwx1234', repeat('e',64))$$, 'a revoked key frees its slot');
reset role;
select is((select count(*)::int from audit_log where action = 'api_key.create' and org_id = 'cccccc39-0000-0000-0000-000000000001'), 3, 'each creation is audited');
select is((select count(*)::int from audit_log where action like 'api_key.%' and (after::text ~ '[0-9a-f]{64}' or before::text ~ '[0-9a-f]{64}')), 0, 'no audit row contains a hash');
select is((select after->>'prefix' from audit_log where action = 'api_key.create' order by id limit 1), 'abcd1234', 'audit rows carry the prefix');

-- organization state
update organizations set status = 'suspended' where id = 'cccccc39-0000-0000-0000-000000000001';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), null, 'keys of a suspended organization stop working');
reset role;
update organizations set status = 'active' where id = 'cccccc39-0000-0000-0000-000000000001';
update organizations set type = 'individual' where id = 'cccccc39-0000-0000-0000-000000000001';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), null, 'keys of an organization that is no longer eligible stop working');
reset role;
update organizations set type = 'client_company' where id = 'cccccc39-0000-0000-0000-000000000001';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), 'cccccc39-0000-0000-0000-000000000001'::uuid, 'and work again when the organization is back');

-- plan and creator rules
update api_keys set created_at = now() - interval '2 days' where prefix = 'efgh5678';
update api_keys set created_at = now() - interval '1 day' where prefix = 'uvwx1234';
update platform_settings set value = '{"default":0}' where key = 'limits.api_keys';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), null, 'a plan whose limit dropped to zero cuts access');
reset role;
update platform_settings set value = '{"default":1}' where key = 'limits.api_keys';
set local role service_role;
select is(api_key_authenticate(repeat('e',64)), 'cccccc39-0000-0000-0000-000000000001'::uuid, 'after a downgrade to one key the newest key still works');
select is(api_key_authenticate(repeat('b',64)), null, 'and the older key is cut');
reset role;
update platform_settings set value = '{"default":2}' where key = 'limits.api_keys';
update memberships set role = 'owner' where user_id = 'aaaaaa39-0000-0000-0000-000000000002' and org_id = 'cccccc39-0000-0000-0000-000000000001';
update memberships set role = 'admin' where user_id = 'aaaaaa39-0000-0000-0000-000000000001' and org_id = 'cccccc39-0000-0000-0000-000000000001';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), null, 'a key whose creator is no longer an owner is paused');
reset role;
update memberships set role = 'owner' where user_id = 'aaaaaa39-0000-0000-0000-000000000001' and org_id = 'cccccc39-0000-0000-0000-000000000001';
update memberships set role = 'admin' where user_id = 'aaaaaa39-0000-0000-0000-000000000002' and org_id = 'cccccc39-0000-0000-0000-000000000001';
set local role service_role;
select is(api_key_authenticate(repeat('b',64)), 'cccccc39-0000-0000-0000-000000000001'::uuid, 'and works again when they are an owner again');
reset role;
update profiles set display_name = 'Owner One' where id = 'aaaaaa39-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select is((select created_by_name from api_keys_list('cccccc39-0000-0000-0000-000000000001') where prefix = 'efgh5678'), 'Owner One', 'the list shows who created each key');
select is((select creator_active from api_keys_list('cccccc39-0000-0000-0000-000000000001') where prefix = 'efgh5678'), true, 'and whether that person is still an owner');
reset role;

-- read RPCs
select is(jsonb_array_length(api_v1_projects('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'), 5, 'projects: all five of the organization, none of the other');
select is(api_v1_projects('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'->0->>'title', 'Project five open', 'projects: newest first');
select is(api_v1_projects('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'next', 'null'::jsonb, 'projects: one page has no cursor');
select is(api_v1_projects('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'->2->>'proposals_count', '1', 'projects: proposals_count counts proposals');
select is(api_v1_projects('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'->3->>'proposals_count', '2', 'projects: proposals_count of project two');
create temp table t_page1 as select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 2, null, null) as j;
grant select on t_page1 to service_role;
select is((select jsonb_array_length(j->'data') from t_page1), 2, 'projects: the page honors the limit');
select isnt((select j->'next' from t_page1), 'null'::jsonb, 'projects: a full page gives a cursor');
create temp table t_page2 as select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 2, ((select j from t_page1)->'next'->>'ts')::timestamptz, ((select j from t_page1)->'next'->>'id')::uuid) as j;
select is((select j->'data'->0->>'title' from t_page2), 'Project three open', 'projects: the cursor continues where the page ended');
create temp table t_page3 as select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 2, ((select j from t_page2)->'next'->>'ts')::timestamptz, ((select j from t_page2)->'next'->>'id')::uuid) as j;
select is((select jsonb_array_length(j->'data') from t_page3), 1, 'projects: the last page holds the remainder');
select is((select j->'next' from t_page3), 'null'::jsonb, 'projects: and has no cursor');
select throws_ok($$select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 0, null, null)$$, '22023', null, 'projects: a zero limit is invalid');
select throws_ok($$select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 101, null, null)$$, '22023', null, 'projects: a limit above 100 is invalid');
select is(jsonb_array_length(api_v1_projects('cccccc39-0000-0000-0000-000000000002', 50, null, null)->'data'), 1, 'projects: the other organization sees only its own');
select is(jsonb_array_length(api_v1_proposals('cccccc39-0000-0000-0000-000000000001', 50, null, null, null)->'data'), 3, 'proposals: only proposals on the organization''s projects');
select is(api_v1_proposals('cccccc39-0000-0000-0000-000000000001', 50, null, null, null)::text like '%SECRET COVER LETTER%', false, 'proposals: the cover letter is never returned');
select is(jsonb_array_length(api_v1_proposals('cccccc39-0000-0000-0000-000000000001', 50, null, null, 'eeeeee39-0000-0000-0000-000000000002')->'data'), 2, 'proposals: the project filter narrows the list');
select is(jsonb_array_length(api_v1_proposals('cccccc39-0000-0000-0000-000000000001', 50, null, null, 'eeeeee39-0000-0000-0000-000000000099')->'data'), 0, 'proposals: another organization''s project id returns nothing');
select is(jsonb_array_length(api_v1_contracts('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'), 1, 'contracts: only the organization''s');
select is(api_v1_contracts('cccccc39-0000-0000-0000-000000000001', 50, null, null)->'data'->0->>'provider', 'Provider One', 'contracts: the provider name is shown');
select is(api_v1_contracts('cccccc39-0000-0000-0000-000000000001', 50, null, null)::text like '%commission%', false, 'contracts: internal commission rates are not exposed');
reset role;

-- analytics split
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
create temp table t_an as select org_analytics('cccccc39-0000-0000-0000-000000000001', 30) as j;
grant select on t_an to service_role;
reset role;
set local role service_role;
select is(org_analytics_compute('cccccc39-0000-0000-0000-000000000001', 30), (select j from t_an), 'the service computation equals the signed-in one');
select is((org_analytics_compute('cccccc39-0000-0000-0000-000000000001', 365)->>'capped')::boolean, true, 'and applies the same plan window cap');
reset role;

-- closed to everyone but the service role
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa39-0000-0000-0000-000000000001',true);
select throws_ok($$select api_key_authenticate(repeat('b',64))$$, '42501', null, 'a signed-in user cannot authenticate keys');
select throws_ok($$select api_v1_projects('cccccc39-0000-0000-0000-000000000001', 10, null, null)$$, '42501', null, 'a signed-in user cannot call the v1 RPCs');
select throws_ok($$select org_analytics_compute('cccccc39-0000-0000-0000-000000000001', 30)$$, '42501', null, 'a signed-in user cannot call the raw computation');
reset role;
set local role anon;
select throws_ok($$select api_key_authenticate(repeat('b',64))$$, '42501', null, 'anon cannot authenticate keys');
select throws_ok($$select api_key_create('cccccc39-0000-0000-0000-000000000001','Anon', 'qrst7890', repeat('d',64))$$, '42501', null, 'anon cannot create keys');
reset role;

select * from finish();
rollback;

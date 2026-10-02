begin;
select plan(27);

insert into auth.users (id, email) values
 ('aaaaaaa7-0000-0000-0000-000000000001','owner@x.test'),
 ('aaaaaaa7-0000-0000-0000-000000000002','member@x.test'),
 ('aaaaaaa7-0000-0000-0000-000000000003','viewer@x.test'),
 ('aaaaaaa7-0000-0000-0000-000000000004','multi@x.test');
insert into organizations (id, type, name) values
 ('cccccccc-7777-0000-0000-00000000000a','individual','Aisha Architect'),
 ('cccccccc-7777-0000-0000-00000000000b','agency','Beta Studio'),
 ('cccccccc-7777-0000-0000-00000000000c','client_company','Gamma Client');
insert into memberships (user_id, org_id, role) values
 ('aaaaaaa7-0000-0000-0000-000000000001','cccccccc-7777-0000-0000-00000000000a','owner'),
 ('aaaaaaa7-0000-0000-0000-000000000002','cccccccc-7777-0000-0000-00000000000a','member'),
 ('aaaaaaa7-0000-0000-0000-000000000003','cccccccc-7777-0000-0000-00000000000a','viewer'),
 ('aaaaaaa7-0000-0000-0000-000000000004','cccccccc-7777-0000-0000-00000000000b','owner'),
 ('aaaaaaa7-0000-0000-0000-000000000004','cccccccc-7777-0000-0000-00000000000c','owner');

-- slug helper
select is(make_slug('Senior Architect — Dubai!'), 'senior-architect-dubai', 'slug: ascii words hyphenated');
select matches(make_slug('مهندس'), '^p-[0-9a-f]{8}$', 'slug: arabic-only falls back to p-<hex>');
select matches(make_slug('😀😀'), '^p-[0-9a-f]{8}$', 'slug: emoji-only falls back to p-<hex>');
select ok(length(make_slug(repeat('abc ', 60))) <= 60, 'slug: truncated to 60');

-- anon: base tables closed
set local role anon;
select throws_ok($$select * from provider_profiles$$, '42501', null, 'anon cannot read provider_profiles');
select throws_ok($$select * from services$$, '42501', null, 'anon cannot read services');

-- writes: only owner/admin of a provider org
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000003',true);
select throws_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000a','Senior Architect','Summary text here','AE',array['en'],100,200,'USD','available','public',array[]::uuid[])$$, '42501', null, 'viewer cannot write profile');
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000002',true);
select throws_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000a','Senior Architect','Summary text here','AE',array['en'],100,200,'USD','available','public',array[]::uuid[])$$, '42501', null, 'member cannot write profile');
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000004',true);
select throws_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000a','Senior Architect','Summary text here','AE',array['en'],100,200,'USD','available','public',array[]::uuid[])$$, '42501', null, 'other org owner cannot write profile');
select throws_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000c','Client Co','Summary text here','AE',array['en'],100,200,'USD','available','public',array[]::uuid[])$$, '22023', null, 'client_company org cannot have a provider profile (explicit org, not first membership)');

select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000001',true);
select lives_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000a','Senior Architect','Summary text here','AE',array['en','ar'],100,200,'USD','available','public',(select array_agg(id) from (select id from skills order by slug limit 2) s))$$, 'owner can create profile');
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000004',true);
select lives_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000b','Senior Architect','Another summary','AE',array['en'],50,90,'USD','limited','public',array[]::uuid[])$$, 'agency owner can create profile with same headline');
select isnt((select slug from provider_profiles where org_id='cccccccc-7777-0000-0000-00000000000a'), (select slug from provider_profiles where org_id='cccccccc-7777-0000-0000-00000000000b'), 'same headline yields distinct slugs');
select is((select slug from provider_profiles where org_id='cccccccc-7777-0000-0000-00000000000b'), 'senior-architect-2', 'collision suffix -2');
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000001',true);
select lives_ok($$select upsert_provider_profile('cccccccc-7777-0000-0000-00000000000a','Principal Architect','Summary text here','AE',array['en'],100,200,'USD','available','public',array[]::uuid[])$$, 'owner can edit headline');
select is((select slug from provider_profiles where org_id='cccccccc-7777-0000-0000-00000000000a'), 'senior-architect', 'slug stays stable after headline edit');
select is((select count(*) from provider_profiles)::int, 1, 'user only sees own org profile via base table');

-- public view
reset role; set local role anon;
select is((select count(*) from public_provider_cards where slug='senior-architect')::int, 1, 'anon sees public profile card');
select is((select count(*) from information_schema.columns where table_name='public_provider_cards' and column_name in ('org_id','created_by','status','visibility'))::int, 0, 'card view exposes no org id or internal columns');
reset role;
update provider_profiles set visibility='private' where org_id='cccccccc-7777-0000-0000-00000000000a';
set local role anon;
select is((select count(*) from public_provider_cards where slug='senior-architect')::int, 0, 'private profile hidden from anon');
reset role;
update provider_profiles set visibility='public', status='hidden_by_admin' where org_id='cccccccc-7777-0000-0000-00000000000a';
set local role anon;
select is((select count(*) from public_provider_cards where slug='senior-architect')::int, 0, 'admin-hidden profile hidden from anon');
reset role;
update provider_profiles set status='active' where org_id='cccccccc-7777-0000-0000-00000000000a';

-- services + limit
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000001',true);
select lives_ok($t$do $b$ begin for i in 1..5 loop perform upsert_service('cccccccc-7777-0000-0000-00000000000a', null, (select id from categories where slug='architecture'), 'Design service '||i, 'Description of service number '||i, 'fixed', 50000, 'USD', 7, 'published'); end loop; end $b$$t$, 'five published services allowed');
select throws_ok($$select upsert_service('cccccccc-7777-0000-0000-00000000000a', null, (select id from categories where slug='architecture'), 'Sixth service', 'Description of sixth', 'fixed', 50000, 'USD', 7, 'published')$$, '54000', null, 'sixth published service refused (limit 5)');
select lives_ok($$select upsert_service('cccccccc-7777-0000-0000-00000000000a', null, (select id from categories where slug='architecture'), 'Draft service', 'Description of draft', 'fixed', 50000, 'USD', 7, 'draft')$$, 'drafts do not count toward limit');
reset role; set local role anon;
select is((select count(*) from public_service_cards)::int, 5, 'anon sees only the five published services');

-- portfolio limit
reset role;
update platform_settings set value='{"default":2}'::jsonb where key='limits.max_portfolio_items';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa7-0000-0000-0000-000000000001',true);
select lives_ok($$insert into portfolio_items (profile_id, org_id, title) select id, org_id, 'Item '||g from provider_profiles, generate_series(1,2) g where org_id='cccccccc-7777-0000-0000-00000000000a'$$, 'two portfolio items allowed');
select throws_ok($$insert into portfolio_items (profile_id, org_id, title) select id, org_id, 'Item 3' from provider_profiles where org_id='cccccccc-7777-0000-0000-00000000000a'$$, '54000', null, 'third portfolio item refused');

select * from finish();
rollback;

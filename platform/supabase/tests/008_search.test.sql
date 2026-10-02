begin;
select plan(18);

-- fixture: orgs + profiles inserted directly (superuser) for speed
insert into organizations (id, type, name)
select ('cccccccc-8888-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'individual', 'Provider ' || g from generate_series(1, 70) g;

insert into provider_profiles (id, org_id, slug, headline, summary, country, hourly_min, hourly_max, availability, visibility, status, updated_at) values
 ('dddddddd-8888-0000-0000-000000000001','cccccccc-8888-0000-0000-000000000001','senior-architect','Senior Architect','BIM and concept design in Dubai','AE',100,200,'available','public','active', now()),
 ('dddddddd-8888-0000-0000-000000000002','cccccccc-8888-0000-0000-000000000002','structural-engineer','Structural Engineer','Steel and concrete structures','SA',40,80,'limited','public','active', now() - interval '1 day'),
 ('dddddddd-8888-0000-0000-000000000003','cccccccc-8888-0000-0000-000000000003','quantity-surveyor','Quantity Surveyor','BOQ and cost estimating','AE',30,60,'available','public','active', now() - interval '2 day'),
 ('dddddddd-8888-0000-0000-000000000004','cccccccc-8888-0000-0000-000000000004','secret-architect','Secret Architect','private architect','AE',10,20,'available','private','active', now()),
 ('dddddddd-8888-0000-0000-000000000005','cccccccc-8888-0000-0000-000000000005','hidden-architect','Hidden Architect','hidden architect','AE',10,20,'available','public','hidden_by_admin', now());

insert into provider_profiles (org_id, slug, headline, summary, availability, updated_at)
select ('cccccccc-8888-0000-0000-' || lpad((g + 10)::text, 12, '0'))::uuid, 'bulk-' || g, 'Bulk Provider ' || g, 'bulk filler', 'available', now() - (g || ' minutes')::interval
from generate_series(1, 60) g;

insert into provider_skills (profile_id, skill_id)
select 'dddddddd-8888-0000-0000-000000000001', id from skills where slug = 'bim-modelling';
insert into provider_skills (profile_id, skill_id)
select 'dddddddd-8888-0000-0000-000000000002', id from skills where slug = 'structural-analysis';

insert into services (org_id, slug, title, description, pricing_model, price_min, status, category_id) values
 ('cccccccc-8888-0000-0000-000000000001','svc-design','Villa concept design','Complete concept design package','fixed',500000,'published',(select id from categories where slug='architecture')),
 ('cccccccc-8888-0000-0000-000000000001','svc-draft','Draft design service','Not yet published design','fixed',100,'draft',(select id from categories where slug='architecture')),
 ('cccccccc-8888-0000-0000-000000000002','svc-struct','Structural design review','Independent review of structural design','fixed',300000,'published',(select id from categories where slug='civil-structural'));

-- anon can search
set local role anon;
select is((select count(*) from search_provider_cards('architect', null, null, null, null, null, null, null, 20))::int, 1, 'text match finds the public architect only (private and hidden excluded)');
select is((select (card->>'slug') from search_provider_cards('architect', null, null, null, null, null, null, null, 20)), 'senior-architect', 'result carries the public card');
select is((select count(*) from search_provider_cards('architct', null, null, null, null, null, null, null, 20))::int, 1, 'typo still matches via trigram');
select is((select count(*) from search_provider_cards('engineer', null, null, 'SA', null, null, null, null, 20))::int, 1, 'country filter');
select is((select count(*) from search_provider_cards('architect', null, null, 'SA', null, null, null, null, 20))::int, 0, 'country filter excludes non-matching');
select is((select count(*) from search_provider_cards(null, null, array[(select id from skills where slug='bim-modelling')], null, null, null, null, null, 20))::int, 1, 'skill filter');
select is((select count(*) from search_provider_cards('surveyor', null, null, null, 50, null, null, null, 20))::int, 1, 'rate_max filter keeps rates starting at or below 50');
select is((select count(*) from search_provider_cards('architect', null, null, null, 50, null, null, null, 20))::int, 0, 'rate_max filter excludes higher starting rates');
select is((select count(*) from search_provider_cards('engineer', null, null, null, null, 'limited', null, null, 20))::int, 1, 'availability filter');
select is((select count(*) from search_provider_cards(null, (select id from categories where slug='civil-structural'), null, null, null, null, null, null, 20))::int, 1, 'category filter via skills');

-- hostile queries never error
select lives_ok($t$do $b$ declare q text; begin
  foreach q in array array[E'\'; drop table x; --', '&|:*', E'"unterminated', '\', '😀', '   ', '', repeat('a', 300), '!!! ((( )))'] loop
    perform count(*) from search_provider_cards(q, null, null, null, null, null, null, null, 20);
    perform count(*) from search_service_cards(q, null, null, null, null, 20);
  end loop; end $b$$t$, 'hostile query strings never raise');
select is((select count(*) from search_provider_cards('   ', null, null, null, null, null, null, null, 1000))::int, 50, 'whitespace query browses and limit is clamped to 50');

-- keyset pagination over browse mode
select is(
  (select array_agg(id order by rank desc, id) from (select id, rank from search_provider_cards(null, null, null, null, null, null, null, null, 6)) a),
  (select array_agg(id order by rank desc, id) from (
     select id, rank from search_provider_cards(null, null, null, null, null, null, null, null, 3)
     union all
     select id, rank from search_provider_cards(null, null, null, null, null, null,
        (select rank from search_provider_cards(null, null, null, null, null, null, null, null, 3) order by rank asc, id desc limit 1),
        (select id from search_provider_cards(null, null, null, null, null, null, null, null, 3) order by rank asc, id desc limit 1), 3)) x),
  'two pages of 3 equal one page of 6 (stable keyset order)');
select is(
  (select count(distinct id) from (
     select id from search_provider_cards(null, null, null, null, null, null, null, null, 3)
     union all
     select id from search_provider_cards(null, null, null, null, null, null,
        (select rank from search_provider_cards(null, null, null, null, null, null, null, null, 3) order by rank asc, id desc limit 1),
        (select id from search_provider_cards(null, null, null, null, null, null, null, null, 3) order by rank asc, id desc limit 1), 3)) x)::int,
  6, 'page 2 shares no id with page 1');

-- services
select is((select count(*) from search_service_cards('design', null, null, null, null, 20))::int, 2, 'service search finds published matches only (draft excluded)');
select is((select count(*) from search_service_cards('design', (select id from categories where slug='civil-structural'), null, null, null, 20))::int, 1, 'service category filter');
select is((select count(*) from search_service_cards('design', null, 400000, null, null, 20))::int, 1, 'service price_max filter');
select is((select count(*) from search_service_cards('', null, null, null, null, 20))::int, 2, 'service browse lists published services');

select * from finish();
rollback;

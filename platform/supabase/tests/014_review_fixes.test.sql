begin;
select plan(15);

insert into auth.users (id, email) values
 ('aaaaaa14-0000-0000-0000-000000000001','admin@x.test'),
 ('aaaaaa14-0000-0000-0000-000000000002','client@x.test'),
 ('aaaaaa14-0000-0000-0000-000000000003','prov@x.test'),
 ('aaaaaa14-0000-0000-0000-000000000004','stranger@x.test'),
 ('aaaaaa14-0000-0000-0000-000000000005','priv@x.test');
insert into platform_roles (user_id, role) values ('aaaaaa14-0000-0000-0000-000000000001','admin');
insert into organizations (id, type, name) values
 ('cccccc14-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc14-0000-0000-0000-00000000000a','individual','Provider A'),
 ('cccccc14-0000-0000-0000-00000000000b','agency','Private Agency');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa14-0000-0000-0000-000000000002','cccccc14-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa14-0000-0000-0000-000000000003','cccccc14-0000-0000-0000-00000000000a','owner'),
 ('aaaaaa14-0000-0000-0000-000000000005','cccccc14-0000-0000-0000-00000000000b','owner');
insert into categories (id, slug, name) values ('99999914-0000-0000-0000-000000000001','cat14','Cat 14');
insert into skills (id, slug, name, category_id) values ('99999914-0000-0000-0000-000000000002','skill14','Skill 14','99999914-0000-0000-0000-000000000001');
insert into provider_profiles (id, org_id, slug, headline, visibility) values
 ('dddddd14-0000-0000-0000-000000000001','cccccc14-0000-0000-0000-00000000000a','prov-a','Provider A headline','public'),
 ('dddddd14-0000-0000-0000-000000000002','cccccc14-0000-0000-0000-00000000000b','prov-b','Private headline','private');
insert into provider_skills (profile_id, skill_id) values ('dddddd14-0000-0000-0000-000000000001','99999914-0000-0000-0000-000000000002');
insert into services (org_id, slug, title, status, category_id) values
 ('cccccc14-0000-0000-0000-00000000000a','svc-a','Service A','published','99999914-0000-0000-0000-000000000001');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee14-0000-0000-0000-000000000001','cccccc14-0000-0000-0000-00000000000c','Awaiting review','Detailed description','USD','pending_review','members_only'),
 ('eeeeee14-0000-0000-0000-000000000002','cccccc14-0000-0000-0000-00000000000c','Already open','Detailed description','USD','open','members_only');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days) values
 ('ffffff14-0000-0000-0000-000000000001','eeeeee14-0000-0000-0000-000000000002','cccccc14-0000-0000-0000-00000000000b','Hello',1000,'USD',5);

-- (a) premoderation exit
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000002',true);
select throws_ok($$select admin_review_project('eeeeee14-0000-0000-0000-000000000001', true, 'ok')$$, '42501', null, 'a project owner cannot approve their own project');
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000001',true);
select throws_ok($$select admin_review_project('eeeeee14-0000-0000-0000-000000000001', true, 'ok')$$, '42501', null, 'staff without a second factor cannot approve');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select admin_review_project('eeeeee14-0000-0000-0000-000000000002', true, 'ok')$$, '22023', null, 'only a project awaiting review can be reviewed');
select lives_ok($$select admin_review_project('eeeeee14-0000-0000-0000-000000000001', true, 'Looks fine')$$, 'staff with aal2 approves');
reset role;
select is((select status from projects where id = 'eeeeee14-0000-0000-0000-000000000001'), 'open', 'approved project is open');
select is((select count(*) from audit_log where action = 'marketplace.approve' and entity_id = 'eeeeee14-0000-0000-0000-000000000001')::int, 1, 'approval is audited');

-- (b1) match candidates
set local role anon;
select throws_ok($$select * from provider_match_candidates$$, '42501', null, 'anon cannot read match candidates');
reset role; set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000002',true);
select is((select count(*) from provider_match_candidates)::int, 1, 'a client sees exactly the public provider (private profile excluded)');
select is((select cardinality(skill_ids) from provider_match_candidates where slug = 'prov-a'), 1, 'candidate carries skill ids');
select is((select cardinality(category_ids) from provider_match_candidates where slug = 'prov-a'), 1, 'candidate carries category ids from published services');
select hasnt_column('public','provider_match_candidates','org_id','candidates expose no organization id');
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000003',true);
select is((select count(*) from provider_match_candidates)::int, 0, 'a provider never sees their own profile as a candidate');

-- (b2) proposal providers
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000002',true);
select is((select headline from proposal_providers where proposal_id = 'ffffff14-0000-0000-0000-000000000001'), 'Private headline', 'the client sees who proposed');
select is((select slug from proposal_providers where proposal_id = 'ffffff14-0000-0000-0000-000000000001'), null, 'a private profile exposes no slug');
select set_config('request.jwt.claim.sub','aaaaaa14-0000-0000-0000-000000000004',true);
select is((select count(*) from proposal_providers)::int, 0, 'a stranger sees no proposer labels');

select * from finish();
rollback;

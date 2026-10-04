begin;
select plan(61);
create function extensions.t_pid(s text) returns uuid language sql security definer set search_path = public as $$ select id from provider_profiles where slug = s $$;
insert into auth.users (id, email, email_confirmed_at) values
('aaaaaa38-0000-0000-0000-000000000001','u1@x.test', now()),('aaaaaa38-0000-0000-0000-000000000002','u2@x.test', now()),('aaaaaa38-0000-0000-0000-000000000003','u3@x.test', now()),('aaaaaa38-0000-0000-0000-000000000004','u4@x.test', now()),('aaaaaa38-0000-0000-0000-000000000005','u5@x.test', now()),('aaaaaa38-0000-0000-0000-000000000006','u6@x.test', now()),('aaaaaa38-0000-0000-0000-000000000007','u7@x.test', now()),('aaaaaa38-0000-0000-0000-000000000008','u8@x.test', now());
insert into organizations (id, type, name) values
 ('cccccc38-0000-0000-0000-000000000001','client_company','Client One'),('cccccc38-0000-0000-0000-000000000002','client_company','Client Two'),('cccccc38-0000-0000-0000-000000000003','enterprise','Empty Enterprise'),
 ('cccccc38-0000-0000-0000-000000000005','individual','Provider One'),('cccccc38-0000-0000-0000-000000000006','individual','Provider Two');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000001','owner'),('aaaaaa38-0000-0000-0000-000000000002','cccccc38-0000-0000-0000-000000000001','admin'),('aaaaaa38-0000-0000-0000-000000000003','cccccc38-0000-0000-0000-000000000001','member'),('aaaaaa38-0000-0000-0000-000000000004','cccccc38-0000-0000-0000-000000000001','viewer'),
 ('aaaaaa38-0000-0000-0000-000000000005','cccccc38-0000-0000-0000-000000000005','owner'),('aaaaaa38-0000-0000-0000-000000000006','cccccc38-0000-0000-0000-000000000006','owner'),('aaaaaa38-0000-0000-0000-000000000007','cccccc38-0000-0000-0000-000000000002','owner'),('aaaaaa38-0000-0000-0000-000000000008','cccccc38-0000-0000-0000-000000000003','owner');
insert into provider_profiles (id, org_id, slug, headline) values
 ('dddddd38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000005','an-p1','Provider one headline'),('dddddd38-0000-0000-0000-000000000002','cccccc38-0000-0000-0000-000000000006','an-p2','Provider two headline');
-- projects: A open (10d), B closed (20d, hired), C closed (30d... 28d, hired), D cancelled (5d), E draft (2d), F old (200d, hired), G other org
insert into projects (id, org_id, title, description, status, created_at) values
 ('eeeeee38-0000-0000-0000-00000000000a','cccccc38-0000-0000-0000-000000000001','Project A open','A long enough description','open', now() - interval '10 days'),
 ('eeeeee38-0000-0000-0000-00000000000b','cccccc38-0000-0000-0000-000000000001','Project B closed','A long enough description','closed', now() - interval '20 days'),
 ('eeeeee38-0000-0000-0000-00000000000c','cccccc38-0000-0000-0000-000000000001','Project C closed','A long enough description','closed', now() - interval '29 days'),
 ('eeeeee38-0000-0000-0000-00000000000d','cccccc38-0000-0000-0000-000000000001','Project D cancel','A long enough description','cancelled', now() - interval '5 days'),
 ('eeeeee38-0000-0000-0000-00000000000e','cccccc38-0000-0000-0000-000000000001','Project E draft','A long enough description','draft', now() - interval '2 days'),
 ('eeeeee38-0000-0000-0000-00000000000f','cccccc38-0000-0000-0000-000000000001','Project F old','A long enough description','closed', now() - interval '200 days'),
 ('eeeeee38-0000-0000-0000-000000000010','cccccc38-0000-0000-0000-000000000001','Project H old draft offer','A long enough description','closed', now() - interval '200 days'),
 ('eeeeee38-0000-0000-0000-000000000099','cccccc38-0000-0000-0000-000000000002','Project G other','A long enough description','closed', now() - interval '10 days');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff38-0000-0000-0000-0000000000a1','eeeeee38-0000-0000-0000-00000000000a','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'submitted'),
 ('ffffff38-0000-0000-0000-0000000000a2','eeeeee38-0000-0000-0000-00000000000a','cccccc38-0000-0000-0000-000000000006','Offer',1000,'USD',7,'shortlisted'),
 ('ffffff38-0000-0000-0000-0000000000b1','eeeeee38-0000-0000-0000-00000000000b','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'hired'),
 ('ffffff38-0000-0000-0000-0000000000c1','eeeeee38-0000-0000-0000-00000000000c','cccccc38-0000-0000-0000-000000000006','Offer',1000,'EUR',7,'hired'),
 ('ffffff38-0000-0000-0000-0000000000d1','eeeeee38-0000-0000-0000-00000000000d','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'declined'),
 ('ffffff38-0000-0000-0000-0000000000f1','eeeeee38-0000-0000-0000-00000000000f','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'shortlisted'),
 ('ffffff38-0000-0000-0000-0000000000e1','eeeeee38-0000-0000-0000-000000000010','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'hired'),
 ('ffffff38-0000-0000-0000-000000000991','eeeeee38-0000-0000-0000-000000000099','cccccc38-0000-0000-0000-000000000005','Offer',1000,'USD',7,'shortlisted');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status, created_at) values
 ('99999938-0000-0000-0000-0000000000b1','eeeeee38-0000-0000-0000-00000000000b','ffffff38-0000-0000-0000-0000000000b1','cccccc38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000005','Contract B',10000,'USD',500,200,'active', now() - interval '15 days'),
 ('99999938-0000-0000-0000-0000000000c1','eeeeee38-0000-0000-0000-00000000000c','ffffff38-0000-0000-0000-0000000000c1','cccccc38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000006','Contract C',5000,'EUR',500,200,'completed', now() - interval '23 days'),
 ('99999938-0000-0000-0000-0000000000a9','eeeeee38-0000-0000-0000-00000000000a','ffffff38-0000-0000-0000-0000000000a2','cccccc38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000006','Contract A cancelled',3000,'USD',500,200,'cancelled', now() - interval '3 days'),
 ('99999938-0000-0000-0000-0000000000f1','eeeeee38-0000-0000-0000-00000000000f','ffffff38-0000-0000-0000-0000000000f1','cccccc38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000005','Contract F old',7000,'USD',500,200,'completed', now() - interval '190 days'),
 ('99999938-0000-0000-0000-0000000000d1','eeeeee38-0000-0000-0000-000000000010','ffffff38-0000-0000-0000-0000000000e1','cccccc38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000005','Contract H draft offer',2000,'USD',500,200,'draft', now() - interval '2 days'),
 ('99999938-0000-0000-0000-000000000991','eeeeee38-0000-0000-0000-000000000099','ffffff38-0000-0000-0000-000000000991','cccccc38-0000-0000-0000-000000000002','cccccc38-0000-0000-0000-000000000005','Contract G other',99999,'USD',500,200,'active', now() - interval '9 days');
insert into milestones (id, contract_id, position, title, amount, status) values
 ('88888838-0000-0000-0000-000000000001','99999938-0000-0000-0000-0000000000b1',1,'M1',4000,'paid'),
 ('88888838-0000-0000-0000-000000000002','99999938-0000-0000-0000-0000000000b1',2,'M2',3000,'paid'),
 ('88888838-0000-0000-0000-000000000003','99999938-0000-0000-0000-0000000000c1',1,'M3',5000,'paid'),
 ('88888838-0000-0000-0000-000000000005','99999938-0000-0000-0000-0000000000b1',3,'M5',2000,'paid'),
 ('88888838-0000-0000-0000-000000000006','99999938-0000-0000-0000-0000000000b1',4,'M6',1000,'paid'),
 ('88888838-0000-0000-0000-000000000004','99999938-0000-0000-0000-000000000991',1,'M4',88888,'paid');
insert into payments (milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status, paid_at) values
 ('88888838-0000-0000-0000-000000000001','99999938-0000-0000-0000-0000000000b1',4000,200,100,4200,300,'USD','succeeded', now() - interval '10 days'),
 ('88888838-0000-0000-0000-000000000002','99999938-0000-0000-0000-0000000000b1',3000,150,75,3150,225,'USD','succeeded', now() - interval '100 days'),
 ('88888838-0000-0000-0000-000000000003','99999938-0000-0000-0000-0000000000c1',5000,250,125,5250,375,'EUR','refunded', now() - interval '20 days'),
 ('88888838-0000-0000-0000-000000000005','99999938-0000-0000-0000-0000000000b1',2000,100,50,2100,150,'USD','refunded', now() - interval '100 days'),
 ('88888838-0000-0000-0000-000000000006','99999938-0000-0000-0000-0000000000b1',1000,50,25,1050,75,'USD','refund_pending', now() - interval '3 days'),
 ('88888838-0000-0000-0000-000000000004','99999938-0000-0000-0000-000000000991',88888,10,10,88898,20,'USD','succeeded', now() - interval '5 days');
-- when the refund happened: M5 was paid 100 days ago and refunded 4 days ago; M3's refund was 20 days ago
alter table payments disable trigger payments_touch;
update payments set updated_at = now() - interval '4 days' where milestone_id = '88888838-0000-0000-0000-000000000005';
update payments set updated_at = now() - interval '20 days' where milestone_id = '88888838-0000-0000-0000-000000000003';
alter table payments enable trigger payments_touch;
-- C's proposal was sent before the invitation to the same professional
update proposals set submitted_at = now() - interval '10 days' where id = 'ffffff38-0000-0000-0000-0000000000c1';
insert into talent_pools (id, org_id, name) values ('77777738-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000001','Pool one'),('77777738-0000-0000-0000-000000000002','cccccc38-0000-0000-0000-000000000001','Pool two');
insert into talent_pool_members (pool_id, profile_id, org_id) values
 ('77777738-0000-0000-0000-000000000001','dddddd38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000001'),('77777738-0000-0000-0000-000000000002','dddddd38-0000-0000-0000-000000000001','cccccc38-0000-0000-0000-000000000001'),('77777738-0000-0000-0000-000000000002','dddddd38-0000-0000-0000-000000000002','cccccc38-0000-0000-0000-000000000001');
insert into project_invitations (project_id, org_id, profile_id, message, status, created_at) values
 ('eeeeee38-0000-0000-0000-00000000000a','cccccc38-0000-0000-0000-000000000001','dddddd38-0000-0000-0000-000000000001','Please send a proposal','sent', now() - interval '4 days'),
 ('eeeeee38-0000-0000-0000-00000000000d','cccccc38-0000-0000-0000-000000000001','dddddd38-0000-0000-0000-000000000002','Please send a proposal','declined', now() - interval '4 days'),
 ('eeeeee38-0000-0000-0000-00000000000c','cccccc38-0000-0000-0000-000000000001','dddddd38-0000-0000-0000-000000000002','Please send a proposal','sent', now() - interval '1 day'),
 ('eeeeee38-0000-0000-0000-00000000000f','cccccc38-0000-0000-0000-000000000001','dddddd38-0000-0000-0000-000000000001','Please send a proposal','sent', now() - interval '199 days');

select is((select count(*)::int from platform_settings where key = 'limits.analytics_days'), 1, 'the migration inserts the analytics window limit');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000001',true);
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->>'days')::int, 30, 'the default plan window is clamped to 30 days');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->>'capped')::boolean, true, 'and the response says it was capped');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->>'capped')::boolean, false, 'a request within the cap is not capped');
reset role;
update platform_settings set value = '{"default":365}' where key = 'limits.analytics_days';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000001',true);
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->>'days')::int, 365, 'a plan with a 365-day window gets it');
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 0)$$, '22023', null, 'zero days is refused');
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 5000)$$, '22023', null, 'more than 3650 days is refused');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000002',true);
select lives_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 30)$$, 'an admin can read analytics');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000003',true);
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 30)$$, '42501', null, 'a member cannot');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000004',true);
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 30)$$, '42501', null, 'a viewer cannot');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000007',true);
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 30)$$, '42501', null, 'an owner of another organization cannot');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000005',true);
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000005', 30)$$, '22023', null, 'an individual provider organization has no hiring analytics');
set local role anon;
select throws_ok($$select org_analytics('cccccc38-0000-0000-0000-000000000001', 30)$$, '42501', null, 'anonymous cannot call it');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000001',true);
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'projects'->>'posted')::int, 4, 'posted counts non-draft projects created in the window');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'projects'->>'open')::int, 1, 'one is open');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'projects'->>'other')::int, 0, 'no project is in another state');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'projects'->>'closed')::int, 2, 'two are closed');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'projects'->>'cancelled')::int, 1, 'one is cancelled');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'projects'->>'posted')::int, 6, 'a longer window includes the older projects');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'proposals'->>'received')::int, 5, 'proposals received on posted projects');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'proposals'->>'shortlisted')::int, 3, 'shortlisted proposals, including those that led to a hire');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'proposals'->>'avg_per_project')::numeric, 1.3, 'average proposals per posted project, one decimal');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'hiring'->>'hired')::int, 2, 'hired counts accepted (non-draft, non-cancelled) contracts created in the window; a draft offer is not a hire');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'hiring'->>'hire_rate_pct')::numeric, 50.0, 'hire rate is hired projects over posted projects');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'hiring'->>'median_days_to_hire')::numeric, 5.5, 'median days from posting to contract');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'contracts'->>'draft')::int, 1, 'a draft offer shows under contracts by status');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'contracts'->>'active')::int, 1, 'contracts by status: active');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'contracts'->>'completed')::int, 1, 'completed');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'contracts'->>'cancelled')::int, 1, 'cancelled');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->1->>'refunded')::int, 2100, 'a payment made long ago but refunded inside the window counts as refunded in the window');
select is(jsonb_array_length(org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'), 2, 'money has one row per currency');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->0->>'currency'), 'EUR', 'currencies are listed alphabetically');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->1->>'committed')::int, 10000, 'USD committed excludes draft offers, cancelled contracts and other organizations');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->1->>'paid')::int, 5000, 'USD paid counts succeeded and refund-pending payments made in the window only');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->1->>'client_fees')::int, 250, 'USD client fees on those payments');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->0->>'committed')::int, 5000, 'EUR committed');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->0->>'paid')::int, 0, 'a refunded payment is not counted as paid');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'money'->0->>'refunded')::int, 5250, 'but is shown as refunded, including its fee, because that is what goes back to the client');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'money'->1->>'committed')::int, 17000, 'a longer window adds the older contract (the old draft offer still does not count)');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'money'->1->>'paid')::int, 8000, 'and the older payment');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'money'->1->>'client_fees')::int, 400, 'and its fee');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'top_providers'->0->>'name'), 'Provider One', 'top providers: most contracts, then name');
select is(jsonb_array_length(org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'top_providers'), 2, 'one row per provider and currency');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'pools')::int, 2, 'talent: pools');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'pooled')::int, 2, 'distinct professionals pooled');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'invites_sent')::int, 3, 'invitations sent in the window');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'invites_declined')::int, 1, 'declined');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'proposals_from_invited')::int, 1, 'invited professionals who then proposed');
select is((org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'talent'->>'invite_to_proposal_pct')::numeric, 33.3, 'invitation-to-proposal rate; a proposal sent before the invitation does not count');
select is((select sum((m->>'projects')::int)::int from jsonb_array_elements(org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'monthly') m), 4, 'monthly projects reconcile with the total');
select is((select sum((m->>'contracts')::int)::int from jsonb_array_elements(org_analytics('cccccc38-0000-0000-0000-000000000001', 30)->'monthly') m), 2, 'monthly contracts reconcile with the total');
select is((select sum((m->>'projects')::int)::int from jsonb_array_elements(org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'monthly') m), 6, 'monthly projects reconcile with the total over a year');
select is((select sum((m->>'contracts')::int)::int from jsonb_array_elements(org_analytics('cccccc38-0000-0000-0000-000000000001', 365)->'monthly') m), 3, 'monthly contracts reconcile over a year, with empty months included');
select ok(jsonb_array_length(org_analytics('cccccc38-0000-0000-0000-000000000001', 3650)->'monthly') <= 13, 'monthly shows at most 13 months (12 whole months plus the partial first one)');
select set_config('request.jwt.claim.sub','aaaaaa38-0000-0000-0000-000000000008',true);
select is((org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'projects'->>'posted')::int, 0, 'an empty organization has zero projects');
select ok((org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'proposals'->'avg_per_project') = 'null'::jsonb, 'with no average');
select ok((org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'hiring'->'hire_rate_pct') = 'null'::jsonb and (org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'hiring'->'median_days_to_hire') = 'null'::jsonb, 'no hire rate and no median');
select ok((org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'talent'->'invite_to_proposal_pct') = 'null'::jsonb, 'no invitation rate');
select is(jsonb_array_length(org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'money') + jsonb_array_length(org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'top_providers'), 0, 'and empty money and provider lists');
select is((select coalesce(sum((m->>'projects')::int + (m->>'contracts')::int), 0)::int from jsonb_array_elements(org_analytics('cccccc38-0000-0000-0000-000000000003', 30)->'monthly') m), 0, 'and only zero months');
select throws_ok($$update platform_settings set value = '1'$$, '42501', null, 'analytics does not open settings to writes');
select * from finish();
rollback;

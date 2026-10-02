begin;
select plan(39);

insert into auth.users (id, email) values
 ('aaaaaa18-0000-0000-0000-000000000001','client@x.test'),
 ('aaaaaa18-0000-0000-0000-000000000003','prov@x.test'),
 ('aaaaaa18-0000-0000-0000-000000000006','stranger@x.test'),
 ('aaaaaa18-0000-0000-0000-000000000007','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc18-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc18-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc18-0000-0000-0000-000000000006','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa18-0000-0000-0000-000000000001','cccccc18-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa18-0000-0000-0000-000000000003','cccccc18-0000-0000-0000-000000000001','owner'),
 ('aaaaaa18-0000-0000-0000-000000000006','cccccc18-0000-0000-0000-000000000006','owner');
insert into platform_roles (user_id, role) values ('aaaaaa18-0000-0000-0000-000000000007','admin');
insert into provider_profiles (org_id, slug, headline) values ('cccccc18-0000-0000-0000-000000000001','prov-one','Structural engineer');
insert into connected_accounts (org_id, stripe_account_id, payouts_enabled) values ('cccccc18-0000-0000-0000-000000000001','acct_p',true);
insert into projects (id, org_id, title, description, currency, status, visibility)
select ('eeeeee18-0000-0000-0000-00000000000' || g)::uuid, 'cccccc18-0000-0000-0000-00000000000c', 'Project ' || g, 'Detailed description', 'USD', 'closed', 'public' from generate_series(1,5) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status)
select ('ffffff18-0000-0000-0000-00000000000' || g)::uuid, ('eeeeee18-0000-0000-0000-00000000000' || g)::uuid, 'cccccc18-0000-0000-0000-000000000001', 'Offer', 40100, 'USD', 10, 'hired' from generate_series(1,5) g;
-- A active (two milestones), D active (one milestone), E active, R completed, R2 completed
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status)
select ('dddddd18-0000-0000-0000-00000000000' || g)::uuid, ('eeeeee18-0000-0000-0000-00000000000' || g)::uuid, ('ffffff18-0000-0000-0000-00000000000' || g)::uuid,
       'cccccc18-0000-0000-0000-00000000000c', 'cccccc18-0000-0000-0000-000000000001', 'Contract ' || g, 40100, 'USD', 500, 200,
       case when g in (1,2,3) then 'active' else 'completed' end from generate_series(1,5) g;
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999918-0000-0000-0000-000000000001','dddddd18-0000-0000-0000-000000000001',1,'A1',40000,'submitted'),
 ('99999918-0000-0000-0000-000000000002','dddddd18-0000-0000-0000-000000000001',2,'A2',100,'submitted'),
 ('99999918-0000-0000-0000-000000000003','dddddd18-0000-0000-0000-000000000002',1,'D1',40100,'submitted');

set local role authenticated;

-- raising disputes
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000006',true);
select throws_ok($$select raise_dispute('cccccc18-0000-0000-0000-000000000006','dddddd18-0000-0000-0000-000000000001','The work was never delivered at all')$$, '42501', null, 'stranger cannot raise a dispute');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000001',true);
select throws_ok($$select raise_dispute('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000001','bad')$$, '22023', null, 'a dispute needs a real reason');
select lives_ok($$select approve_milestone('cccccc18-0000-0000-0000-00000000000c','99999918-0000-0000-0000-000000000001')$$, 'client approves milestone A1 before the dispute');
select lives_ok($$select approve_milestone('cccccc18-0000-0000-0000-00000000000c','99999918-0000-0000-0000-000000000003')$$, 'client approves milestone D1 before the dispute');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select set_config('app.da', (select raise_dispute('cccccc18-0000-0000-0000-000000000001','dddddd18-0000-0000-0000-000000000001','The client changed the scope after approval'))::text, true);
select is((select status from contracts where id = 'dddddd18-0000-0000-0000-000000000001'), 'disputed', 'a dispute freezes the contract');
select throws_ok($$select raise_dispute('cccccc18-0000-0000-0000-000000000001','dddddd18-0000-0000-0000-000000000001','Raising it a second time over')$$, '22023', null, 'a disputed contract cannot be disputed again');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000001',true);
select is((select count(*)::int from notifications where type = 'dispute_opened'), 1, 'the other party is told');
select throws_ok($$select approve_milestone('cccccc18-0000-0000-0000-00000000000c','99999918-0000-0000-0000-000000000002')$$, '22023', null, 'a disputed contract blocks new approvals');
select set_config('app.dd', (select raise_dispute('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000002','Quality is far below what we agreed'))::text, true);

-- an already-open Checkout session can still complete: money moved, record it, but do not advance the frozen contract
reset role; set local role service_role;
select is((select record_payment_succeeded((select id from payments where milestone_id = '99999918-0000-0000-0000-000000000001'), 'cs_a', 'pi_a', 40800, 'USD')), 'recorded', 'a payment already in flight is still recorded');
select is((select record_payment_succeeded((select id from payments where milestone_id = '99999918-0000-0000-0000-000000000003'), 'cs_d', 'pi_d', 40902, 'USD')), 'recorded', 'the last milestone of a disputed contract is recorded');
select is((select status from contracts where id = 'dddddd18-0000-0000-0000-000000000002'), 'disputed', 'a fully paid disputed contract is not silently completed');

-- resolving
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select throws_ok($$select resolve_dispute(current_setting('app.da')::uuid, 'resume', 'ok')$$, '42501', null, 'a party cannot resolve its own dispute');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000006',true);
select is((select count(*)::int from disputes), 0, 'stranger sees no disputes');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select is((select count(*)::int from disputes), 2, 'a party sees the disputes of its contracts');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000007',true);
select throws_ok($$select resolve_dispute(current_setting('app.da')::uuid, 'resume', 'ok')$$, '42501', null, 'staff without a second factor cannot resolve');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select resolve_dispute(current_setting('app.da')::uuid, 'refund', 'ok')$$, '22023', null, 'unknown outcome refused');
select lives_ok($$select resolve_dispute(current_setting('app.da')::uuid, 'resume', 'Work continues')$$, 'staff with aal2 resumes a contract');
select is((select status from contracts where id = 'dddddd18-0000-0000-0000-000000000001'), 'active', 'resumed contract with unpaid milestones is active');
select lives_ok($$select resolve_dispute(current_setting('app.dd')::uuid, 'resume', 'Both sides agreed')$$, 'staff resumes the fully paid contract');
select is((select status from contracts where id = 'dddddd18-0000-0000-0000-000000000002'), 'completed', 'resuming a fully paid contract completes it');
select throws_ok($$select resolve_dispute(current_setting('app.da')::uuid, 'resume', 'again')$$, '22023', null, 'a resolved dispute cannot be resolved again');
select is((select count(*)::int from audit_log where action = 'dispute.resolve'), 2, 'resolutions are audited');
select set_config('request.jwt.claims','{}',true);

-- reviews
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000001',true);
select throws_ok($$select post_review('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000003',5,'Too early')$$, '22023', null, 'no review before the contract completes');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000006',true);
select throws_ok($$select post_review('cccccc18-0000-0000-0000-000000000006','dddddd18-0000-0000-0000-000000000004',5,'Not mine')$$, '42501', null, 'stranger cannot review');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000001',true);
select throws_ok($$select post_review('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000004',6,'Off the scale')$$, '22023', null, 'rating above 5 refused');
select lives_ok($$select post_review('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000004',5,'Excellent work')$$, 'client reviews the provider');
select throws_ok($$select post_review('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000004',4,'Again')$$, '23505', null, 'one review per organization per contract');
select is((select count(*)::int from reviews where contract_id = 'dddddd18-0000-0000-0000-000000000004'), 1, 'the author sees its own review');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select is((select count(*)::int from reviews where contract_id = 'dddddd18-0000-0000-0000-000000000004'), 0, 'the subject cannot see a one-sided review yet');
reset role; set local role anon;
select is((select count(*)::int from public_provider_ratings), 0, 'a one-sided review is not public');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select lives_ok($$select post_review('cccccc18-0000-0000-0000-000000000001','dddddd18-0000-0000-0000-000000000004',4,'Good client')$$, 'provider reviews the client');
select is((select count(*)::int from reviews where contract_id = 'dddddd18-0000-0000-0000-000000000004'), 2, 'once both have posted both reviews are visible');
reset role; set local role anon;
select is((select rating_count::int || '/' || rating_avg::numeric(3,1) from public_provider_ratings where slug = 'prov-one'), '1/5.0', 'public rating aggregates published reviews');
select is((select array_agg(column_name::text order by column_name)::text from information_schema.columns where table_name = 'public_provider_ratings'), '{rating_avg,rating_count,slug}', 'public rating view exposes only aggregates and the slug');
reset role;
insert into reviews (contract_id, author_org_id, subject_org_id, rating, comment, created_at) values
 ('dddddd18-0000-0000-0000-000000000005','cccccc18-0000-0000-0000-00000000000c','cccccc18-0000-0000-0000-000000000001',3,'Slow but fine', now() - interval '15 days');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select is((select count(*)::int from reviews where contract_id = 'dddddd18-0000-0000-0000-000000000005'), 1, 'a one-sided review becomes visible after the reveal window');
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000007',true);
select is((select count(*)::int from reviews), 3, 'platform staff see every review');
reset role;
-- blind reviews close once the other side's review has been revealed
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000003',true);
select throws_ok($$select post_review('cccccc18-0000-0000-0000-000000000001','dddddd18-0000-0000-0000-000000000005',5,'Retaliation')$$, '22023', null, 'a review cannot be written after the other side review became visible');
reset role;
-- a person on both sides cannot review as the client
insert into memberships (user_id, org_id, role) values ('aaaaaa18-0000-0000-0000-000000000001','cccccc18-0000-0000-0000-000000000001','member');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa18-0000-0000-0000-000000000001',true);
select throws_ok($$select post_review('cccccc18-0000-0000-0000-00000000000c','dddddd18-0000-0000-0000-000000000005',5,'Self praise')$$, '42501', null, 'a person on both sides cannot review');
reset role;
select throws_ok($$insert into reviews (contract_id, author_org_id, subject_org_id, rating) values ('dddddd18-0000-0000-0000-000000000005','cccccc18-0000-0000-0000-000000000001','cccccc18-0000-0000-0000-000000000001',5)$$, '23514', null, 'an organization cannot review itself');

select * from finish();
rollback;

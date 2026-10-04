begin;
select plan(42);

insert into auth.users (id, email) values
 ('aaaaaa16-0000-0000-0000-000000000001','client-owner@x.test'),
 ('aaaaaa16-0000-0000-0000-000000000002','client-member@x.test'),
 ('aaaaaa16-0000-0000-0000-000000000003','prov1@x.test'),
 ('aaaaaa16-0000-0000-0000-000000000004','prov2@x.test'),
 ('aaaaaa16-0000-0000-0000-000000000005','multi@x.test'),
 ('aaaaaa16-0000-0000-0000-000000000006','stranger@x.test');
insert into organizations (id, type, name) values
 ('cccccc16-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc16-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc16-0000-0000-0000-000000000002','agency','Provider Two'),
 ('cccccc16-0000-0000-0000-000000000003','agency','Provider Three'),
 ('cccccc16-0000-0000-0000-00000000000d','client_company','Multi Client'),
 ('cccccc16-0000-0000-0000-000000000006','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa16-0000-0000-0000-000000000001','cccccc16-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa16-0000-0000-0000-000000000002','cccccc16-0000-0000-0000-00000000000c','member'),
 ('aaaaaa16-0000-0000-0000-000000000003','cccccc16-0000-0000-0000-000000000001','owner'),
 ('aaaaaa16-0000-0000-0000-000000000004','cccccc16-0000-0000-0000-000000000002','owner'),
 ('aaaaaa16-0000-0000-0000-000000000005','cccccc16-0000-0000-0000-00000000000d','owner'),
 ('aaaaaa16-0000-0000-0000-000000000005','cccccc16-0000-0000-0000-000000000003','owner'),
 ('aaaaaa16-0000-0000-0000-000000000006','cccccc16-0000-0000-0000-000000000006','owner');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee16-0000-0000-0000-000000000001','cccccc16-0000-0000-0000-00000000000c','Project one','Detailed description','USD','open','public'),
 ('eeeeee16-0000-0000-0000-000000000002','cccccc16-0000-0000-0000-00000000000c','Project two','Detailed description','USD','open','public'),
 ('eeeeee16-0000-0000-0000-000000000004','cccccc16-0000-0000-0000-00000000000d','Multi project','Detailed description','USD','open','public'),
 ('eeeeee16-0000-0000-0000-000000000005','cccccc16-0000-0000-0000-00000000000c','Project five','Detailed description','USD','open','public');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff16-0000-0000-0000-000000000001','eeeeee16-0000-0000-0000-000000000001','cccccc16-0000-0000-0000-000000000001','Offer',100000,'USD',10,'shortlisted'),
 ('ffffff16-0000-0000-0000-000000000002','eeeeee16-0000-0000-0000-000000000002','cccccc16-0000-0000-0000-000000000001','Offer',50000,'USD',10,'submitted'),
 ('ffffff16-0000-0000-0000-000000000004','eeeeee16-0000-0000-0000-000000000004','cccccc16-0000-0000-0000-000000000003','Offer',70000,'USD',10,'shortlisted'),
 ('ffffff16-0000-0000-0000-000000000005','eeeeee16-0000-0000-0000-000000000005','cccccc16-0000-0000-0000-000000000002','Offer',30000,'USD',10,'shortlisted');
insert into connected_accounts (org_id, stripe_account_id, payouts_enabled) values
 ('cccccc16-0000-0000-0000-000000000001','acct_test_p1',false);

set local role authenticated;

-- hiring
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000006',true);
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000001')$$, '42501', null, 'stranger cannot hire');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000003',true);
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-000000000001','ffffff16-0000-0000-0000-000000000001')$$, '42501', null, 'the proposing provider cannot hire itself');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000002',true);
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000001')$$, '42501', null, 'a plain member cannot hire');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000002')$$, '22023', null, 'only a shortlisted proposal can be hired');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000005',true);
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-00000000000d','ffffff16-0000-0000-0000-000000000004')$$, '42501', null, 'a person on both sides cannot hire their own other organization');

select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select set_config('app.c', (select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000001'))::text, true);
select ok(current_setting('app.c')::uuid is not null, 'client owner hires from a shortlisted proposal');
select throws_ok($$select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000001')$$, '23505', null, 'a proposal can only be hired once');
select is((select price || '/' || currency || '/' || status || '/' || commission_pro_bps || '/' || commission_client_bps from contracts where id = current_setting('app.c')::uuid), '100000/USD/draft/500/200', 'contract copies the proposal terms and snapshots the commission');
select is((select status from proposals where id = 'ffffff16-0000-0000-0000-000000000001'), 'hired', 'the proposal becomes hired');
select is((select status from projects where id = 'eeeeee16-0000-0000-0000-000000000001'), 'closed', 'the project closes');

select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000003',true);
select is((select count(*)::int from notifications where type = 'contract_offered'), 1, 'the provider is told about the offer');

-- milestones
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000006',true);
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000006', current_setting('app.c')::uuid, '[{"title":"A","amount":1}]'::jsonb)$$, '42501', null, 'stranger cannot set milestones');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000003',true);
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '[]'::jsonb)$$, '22023', null, 'empty milestone list refused');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '{"a":1}'::jsonb)$$, '22023', null, 'non-list refused');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '[{"title":"A","amount":0}]'::jsonb)$$, '22023', null, 'zero amount refused');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '[{"title":"Tiny","amount":9999}]'::jsonb)$$, '22023', null, 'a milestone below the configured minimum is refused');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, (select jsonb_agg(jsonb_build_object('title','M'||g,'amount',1)) from generate_series(1,21) g))$$, '54000', null, 'more milestones than the limit refused');
select lives_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '[{"title":"First","amount":40000},{"title":"Second","amount":50000}]'::jsonb)$$, 'provider proposes milestones');
select throws_ok($$select accept_contract('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid)$$, '22023', null, 'cannot accept while milestones do not add up to the price');
select lives_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid, '[{"title":"First","amount":40000},{"title":"Second","amount":60000}]'::jsonb)$$, 'provider fixes the milestone sum');

-- accept and activate
select lives_ok($$select accept_contract('cccccc16-0000-0000-0000-000000000001', current_setting('app.c')::uuid)$$, 'provider accepts');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000002',true);
select throws_ok($$select accept_contract('cccccc16-0000-0000-0000-00000000000c', current_setting('app.c')::uuid)$$, '42501', null, 'a plain member cannot accept for the client');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select throws_ok($$select activate_contract(current_setting('app.c')::uuid)$$, '22023', null, 'cannot activate before both sides accept');
select lives_ok($$select accept_contract('cccccc16-0000-0000-0000-00000000000c', current_setting('app.c')::uuid)$$, 'client accepts');
select throws_ok($$select activate_contract(current_setting('app.c')::uuid)$$, '22023', null, 'cannot activate while the provider cannot receive payouts');

reset role;
update platform_settings set value = '900' where key = 'commission.professional_bps';
update connected_accounts set payouts_enabled = true where org_id = 'cccccc16-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select lives_ok($$select activate_contract(current_setting('app.c')::uuid)$$, 'contract activates once payouts are enabled');
select is((select status || '/' || commission_pro_bps from contracts where id = current_setting('app.c')::uuid), 'active/500', 'a later commission change does not alter the contract');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-00000000000c', current_setting('app.c')::uuid, '[{"title":"A","amount":100000}]'::jsonb)$$, '22023', null, 'milestones are frozen once active');

-- delivery
select throws_ok($$select submit_milestone('cccccc16-0000-0000-0000-00000000000c', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1))$$, '42501', null, 'client cannot submit a milestone');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000003',true);
select lives_ok($$select submit_milestone('cccccc16-0000-0000-0000-000000000001', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1))$$, 'provider submits a milestone');
select throws_ok($$select submit_milestone('cccccc16-0000-0000-0000-000000000001', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1))$$, '22023', null, 'a submitted milestone cannot be submitted again');
select throws_ok($$select request_changes('cccccc16-0000-0000-0000-000000000001', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1), 'Please fix')$$, '42501', null, 'provider cannot request changes on own work');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select is((select count(*)::int from notifications where type = 'milestone_submitted'), 1, 'the client is told about the submission');
select throws_ok($$select request_changes('cccccc16-0000-0000-0000-00000000000c', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1), '   ')$$, '22023', null, 'a change request needs a note');
select lives_ok($$select request_changes('cccccc16-0000-0000-0000-00000000000c', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1), 'Please fix the drawings')$$, 'client requests changes');
select is((select status from milestones where contract_id = current_setting('app.c')::uuid and position = 1), 'changes_requested', 'milestone shows changes requested');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000003',true);
select lives_ok($$select submit_milestone('cccccc16-0000-0000-0000-000000000001', (select id from milestones where contract_id = current_setting('app.c')::uuid and position = 1))$$, 'provider resubmits after changes');

-- cancel a draft
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000001',true);
select set_config('app.d', (select create_contract('cccccc16-0000-0000-0000-00000000000c','ffffff16-0000-0000-0000-000000000005'))::text, true);
select throws_ok($$select cancel_contract('cccccc16-0000-0000-0000-00000000000c', current_setting('app.c')::uuid, 'no')$$, '22023', null, 'an active contract cannot be cancelled here');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000006',true);
select throws_ok($$select cancel_contract('cccccc16-0000-0000-0000-000000000006', current_setting('app.d')::uuid, 'no')$$, '42501', null, 'stranger cannot cancel');
select set_config('request.jwt.claim.sub','aaaaaa16-0000-0000-0000-000000000004',true);
select lives_ok($$select cancel_contract('cccccc16-0000-0000-0000-000000000002', current_setting('app.d')::uuid, 'Not a fit')$$, 'provider cancels a draft');
select is((select status from contracts where id = current_setting('app.d')::uuid), 'cancelled', 'draft contract is cancelled');
select throws_ok($$select set_milestones('cccccc16-0000-0000-0000-000000000002', current_setting('app.d')::uuid, '[{"title":"A","amount":30000}]'::jsonb)$$, '22023', null, 'a cancelled contract takes no milestones');

select * from finish();
rollback;

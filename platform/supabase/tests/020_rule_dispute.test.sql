begin;
select plan(39);

insert into auth.users (id, email) values
 ('aaaaaa20-0000-0000-0000-000000000001','client@x.test'),('aaaaaa20-0000-0000-0000-000000000003','prov@x.test'),('aaaaaa20-0000-0000-0000-000000000007','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc20-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc20-0000-0000-0000-000000000001','individual','Provider One');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa20-0000-0000-0000-000000000001','cccccc20-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa20-0000-0000-0000-000000000003','cccccc20-0000-0000-0000-000000000001','owner');
insert into platform_roles (user_id, role) values ('aaaaaa20-0000-0000-0000-000000000007','admin');
insert into projects (id, org_id, title, description, currency, status, visibility)
select ('eeeeee20-0000-0000-0000-00000000000' || g)::uuid, 'cccccc20-0000-0000-0000-00000000000c', 'Project ' || g, 'Detailed description', 'USD', 'closed', 'public' from generate_series(1,4) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status)
select ('ffffff20-0000-0000-0000-00000000000' || g)::uuid, ('eeeeee20-0000-0000-0000-00000000000' || g)::uuid, 'cccccc20-0000-0000-0000-000000000001', 'Offer', 40100, 'USD', 10, 'hired' from generate_series(1,4) g;
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status)
select ('dddddd20-0000-0000-0000-00000000000' || g)::uuid, ('eeeeee20-0000-0000-0000-00000000000' || g)::uuid, ('ffffff20-0000-0000-0000-00000000000' || g)::uuid,
       'cccccc20-0000-0000-0000-00000000000c', 'cccccc20-0000-0000-0000-000000000001', 'Contract ' || g, 40100, 'USD', 500, 200, 'disputed' from generate_series(1,4) g;
-- contract 1: two paid milestones and one approved milestone with a pending payment; contracts 2-4: one paid milestone each
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999920-0000-0000-0000-000000000001','dddddd20-0000-0000-0000-000000000001',1,'M1',20000,'paid'),
 ('99999920-0000-0000-0000-000000000002','dddddd20-0000-0000-0000-000000000001',2,'M2',10000,'paid'),
 ('99999920-0000-0000-0000-000000000003','dddddd20-0000-0000-0000-000000000001',3,'M3',10100,'approved'),
 ('99999920-0000-0000-0000-000000000004','dddddd20-0000-0000-0000-000000000002',1,'M4',40100,'paid'),
 ('99999920-0000-0000-0000-000000000005','dddddd20-0000-0000-0000-000000000003',1,'M5',40100,'paid'),
 ('99999920-0000-0000-0000-000000000006','dddddd20-0000-0000-0000-000000000004',1,'M6',40100,'paid');
insert into payments (id, milestone_id, contract_id, payment_intent_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888820-0000-0000-0000-000000000001','99999920-0000-0000-0000-000000000001','dddddd20-0000-0000-0000-000000000001','pi_1',20000,400,1000,20400,1400,'USD','succeeded'),
 ('88888820-0000-0000-0000-000000000002','99999920-0000-0000-0000-000000000002','dddddd20-0000-0000-0000-000000000001','pi_2',10000,200,500,10200,700,'USD','succeeded'),
 ('88888820-0000-0000-0000-000000000003','99999920-0000-0000-0000-000000000003','dddddd20-0000-0000-0000-000000000001',null,10100,202,505,10302,707,'USD','pending'),
 ('88888820-0000-0000-0000-000000000004','99999920-0000-0000-0000-000000000004','dddddd20-0000-0000-0000-000000000002','pi_4',40100,802,2005,40902,2807,'USD','succeeded'),
 ('88888820-0000-0000-0000-000000000005','99999920-0000-0000-0000-000000000005','dddddd20-0000-0000-0000-000000000003','pi_5',40100,802,2005,40902,2807,'USD','succeeded'),
 ('88888820-0000-0000-0000-000000000006','99999920-0000-0000-0000-000000000006','dddddd20-0000-0000-0000-000000000004','pi_6',40100,802,2005,40902,2807,'USD','succeeded');
insert into disputes (id, contract_id, raised_by_org_id, reason) 
select ('77777720-0000-0000-0000-00000000000' || g)::uuid, ('dddddd20-0000-0000-0000-00000000000' || g)::uuid, 'cccccc20-0000-0000-0000-00000000000c', 'The work was never delivered' from generate_series(1,4) g;

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa20-0000-0000-0000-000000000001',true);
select throws_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'refund_cancel', 'Refund the client in full')$$, '42501', null, 'a party cannot rule');
select set_config('request.jwt.claim.sub','aaaaaa20-0000-0000-0000-000000000007',true);
select throws_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'refund_cancel', 'Refund the client in full')$$, '42501', null, 'staff without a second factor cannot rule');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'refund_cancel', 'short')$$, '22023', null, 'a ruling needs a real note');
select throws_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'refund_cancel', null)$$, '22023', null, 'a missing note is refused');
select lives_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'refund_cancel', 'Refund the client in full')$$, 'staff with aal2 rules refund_cancel');
select is((select status from contracts where id = 'dddddd20-0000-0000-0000-000000000001'), 'cancelled', 'the contract is cancelled');
select is((select resolution || '/' || status from disputes where id = '77777720-0000-0000-0000-000000000001'), 'refund_cancel/resolved', 'the dispute records the ruling');
select is((select count(*)::int from refunds where dispute_id = '77777720-0000-0000-0000-000000000001'), 2, 'one refund per succeeded payment');
select is((select count(*)::int from payments where contract_id = 'dddddd20-0000-0000-0000-000000000001' and status = 'refund_pending'), 2, 'succeeded payments move to refund_pending');
select is((select status from payments where id = '88888820-0000-0000-0000-000000000003'), 'pending', 'a pending payment is left alone');
select is((select amount from refunds where payment_id = '88888820-0000-0000-0000-000000000001'), 20400, 'the refund is the full amount the client paid');
select throws_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000001', 'cancel', 'Ruling a second time')$$, '22023', null, 'a resolved dispute cannot be ruled again');
select lives_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000002', 'resume', 'Work continues as agreed')$$, 'resume is accepted');
select is((select count(*)::int from refunds where dispute_id = '77777720-0000-0000-0000-000000000002'), 0, 'resume creates no refund');
select is((select status from payments where id = '88888820-0000-0000-0000-000000000004'), 'succeeded', 'resume leaves payments alone');
select lives_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000003', 'cancel', 'Cancelled without refund')$$, 'cancel is accepted');
select is((select status || '/' || (select count(*) from refunds where dispute_id = '77777720-0000-0000-0000-000000000003') from contracts where id = 'dddddd20-0000-0000-0000-000000000003'), 'cancelled/0', 'cancel ends the contract with no refund');
select lives_ok($$select resolve_dispute('77777720-0000-0000-0000-000000000004', 'complete', 'Delivered and accepted')$$, 'complete is accepted');
select is((select status from contracts where id = 'dddddd20-0000-0000-0000-000000000004'), 'completed', 'complete ends the contract as completed');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select list_pending_refunds('77777720-0000-0000-0000-000000000001')$$, '42501', null, 'users cannot list pending refunds');
select throws_ok($$select record_refund_succeeded('88888820-0000-0000-0000-000000000001', 're_1', 20400, 'USD')$$, '42501', null, 'users cannot record refunds');
select throws_ok($$select record_refund_failed('88888820-0000-0000-0000-000000000001', 'x')$$, '42501', null, 'users cannot record refund failures');
reset role;
select is((select idempotency_key from refunds where payment_id = '88888820-0000-0000-0000-000000000001'), 'refund:88888820-0000-0000-0000-000000000001', 'the idempotency key is deterministic');
set local role service_role;
select is((select count(*)::int from list_pending_refunds('77777720-0000-0000-0000-000000000001')), 2, 'two refunds are pending');
select is((select payment_intent_id from list_pending_refunds('77777720-0000-0000-0000-000000000001') where payment_id = '88888820-0000-0000-0000-000000000001'), 'pi_1', 'the list carries the payment intent');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000001', 're_1', 20401, 'USD')), 'mismatch', 'a refund of a different amount is refused');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000001', 're_1', 20400, 'EUR')), 'mismatch', 'a refund in a different currency is refused');
select is((select status from payments where id = '88888820-0000-0000-0000-000000000001'), 'refund_pending', 'a mismatch changes nothing');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000001', 're_1', 20400, 'USD')), 'recorded', 'a matching refund is recorded');
select is((select status from payments where id = '88888820-0000-0000-0000-000000000001'), 'refunded', 'the payment is refunded');
select is((select status || '/' || provider_refund_id from refunds where payment_id = '88888820-0000-0000-0000-000000000001'), 'succeeded/re_1', 'the refund stores the provider id');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000001', 're_1', 20400, 'USD')), 'duplicate', 'replaying the event changes nothing');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000004', 're_x', 40902, 'USD')), 'unknown', 'a refund nobody queued is ignored');
select is((select record_refund_succeeded('88888820-0000-0000-0000-0000000000ff', 're_x', 1, 'USD')), 'unknown', 'an unknown payment is ignored');
select lives_ok($$select record_refund_failed('88888820-0000-0000-0000-000000000002', 'card network unavailable')$$, 'a failure is recorded');
select is((select status || '/' || failure_reason from refunds where payment_id = '88888820-0000-0000-0000-000000000002'), 'pending/card network unavailable', 'a failed call keeps the refund pending with a reason');
select is((select count(*)::int from list_pending_refunds('77777720-0000-0000-0000-000000000001')), 1, 'only the unfinished refund is still listed');
select is((select record_refund_succeeded('88888820-0000-0000-0000-000000000002', 're_2', 10200, 'USD')), 'recorded', 'the retried refund is recorded');
select is((select count(*)::int from list_pending_refunds('77777720-0000-0000-0000-000000000001')), 0, 'nothing is left to refund');
select * from finish();
rollback;

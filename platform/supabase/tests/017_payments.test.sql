begin;
select plan(54);

insert into auth.users (id, email) values
 ('aaaaaa17-0000-0000-0000-000000000001','client-owner@x.test'),
 ('aaaaaa17-0000-0000-0000-000000000002','client-member@x.test'),
 ('aaaaaa17-0000-0000-0000-000000000003','prov@x.test'),
 ('aaaaaa17-0000-0000-0000-000000000006','stranger@x.test');
insert into organizations (id, type, name) values
 ('cccccc17-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc17-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc17-0000-0000-0000-000000000006','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa17-0000-0000-0000-000000000001','cccccc17-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa17-0000-0000-0000-000000000002','cccccc17-0000-0000-0000-00000000000c','member'),
 ('aaaaaa17-0000-0000-0000-000000000003','cccccc17-0000-0000-0000-000000000001','owner'),
 ('aaaaaa17-0000-0000-0000-000000000006','cccccc17-0000-0000-0000-000000000006','owner');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee17-0000-0000-0000-000000000001','cccccc17-0000-0000-0000-00000000000c','Project','Detailed description','USD','closed','public');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff17-0000-0000-0000-000000000001','eeeeee17-0000-0000-0000-000000000001','cccccc17-0000-0000-0000-000000000001','Offer',40200,'USD',10,'hired');
insert into connected_accounts (org_id, stripe_account_id, payouts_enabled) values
 ('cccccc17-0000-0000-0000-000000000001','acct_test_p',true);
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status, accepted_by_client, accepted_by_provider) values
 ('dddddd17-0000-0000-0000-000000000001','eeeeee17-0000-0000-0000-000000000001','ffffff17-0000-0000-0000-000000000001','cccccc17-0000-0000-0000-00000000000c','cccccc17-0000-0000-0000-000000000001','Contract',40200,'USD',500,200,'active',true,true);
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999917-0000-0000-0000-000000000001','dddddd17-0000-0000-0000-000000000001',1,'First',40000,'submitted'),
 ('99999917-0000-0000-0000-000000000002','dddddd17-0000-0000-0000-000000000001',2,'Second',100,'submitted'),
 ('99999917-0000-0000-0000-000000000003','dddddd17-0000-0000-0000-000000000001',3,'Third',100,'pending');

set local role authenticated;

select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000006',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-000000000006','99999917-0000-0000-0000-000000000001')$$, '42501', null, 'stranger cannot approve');
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000003',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-000000000001','99999917-0000-0000-0000-000000000001')$$, '42501', null, 'provider cannot approve its own milestone');
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000002',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000001')$$, '42501', null, 'a plain client member cannot approve payment');
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000003')$$, '22023', null, 'a milestone that was not submitted cannot be approved');

-- a client owner who is also a member of the provider organization cannot approve (and pay) the provider's work
reset role;
insert into memberships (user_id, org_id, role) values ('aaaaaa17-0000-0000-0000-000000000001','cccccc17-0000-0000-0000-000000000001','member');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000001')$$, '42501', null, 'a person on both sides cannot approve their own milestone');
reset role;
delete from memberships where user_id = 'aaaaaa17-0000-0000-0000-000000000001' and org_id = 'cccccc17-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);

select set_config('app.r1', (select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000001'))::text, true);
select is((current_setting('app.r1')::jsonb ->> 'amount') || '/' || (current_setting('app.r1')::jsonb ->> 'client_fee') || '/' || (current_setting('app.r1')::jsonb ->> 'provider_fee') || '/' || (current_setting('app.r1')::jsonb ->> 'client_total') || '/' || (current_setting('app.r1')::jsonb ->> 'application_fee'), '40000/800/2000/40800/2800', 'approval computes fees from the contract snapshot');
select is((select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000001') ->> 'payment_id'), current_setting('app.r1')::jsonb ->> 'payment_id', 'approving twice returns the same payment');
select is((select count(*)::int from payments where milestone_id = '99999917-0000-0000-0000-000000000001'), 1, 'exactly one payment row per milestone');
select is((select status from milestones where id = '99999917-0000-0000-0000-000000000001'), 'approved', 'milestone is approved awaiting payment');
select is((select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000002') ->> 'application_fee'), '100', 'the minimum application fee applies to tiny amounts');
select throws_ok($$select checkout_session_id from payments$$, '42501', null, 'checkout session ids are not readable by clients');

select throws_ok($$select payment_destination('99999917-0000-0000-0000-000000000009')$$, '42501', null, 'clients cannot read payout destinations');
select throws_ok($$select attach_checkout_session('99999917-0000-0000-0000-000000000009','cs_x',null)$$, '42501', null, 'clients cannot attach checkout sessions');
select throws_ok($$select record_payment_succeeded('99999917-0000-0000-0000-000000000009','cs_x','pi_x',1,'USD')$$, '42501', null, 'clients cannot record payments');
select throws_ok($$select record_payment_failed('99999917-0000-0000-0000-000000000009','cs_x')$$, '42501', null, 'clients cannot record payment failures');
select throws_ok($$select register_connected_account('cccccc17-0000-0000-0000-00000000000c','acct_evil')$$, '42501', null, 'clients cannot register connected accounts');
select throws_ok($$select record_account_update('acct_test_p', true, true)$$, '42501', null, 'clients cannot change account status');
select throws_ok($$select payout_account('cccccc17-0000-0000-0000-000000000001')$$, '42501', null, 'clients cannot read a payout account id');
select throws_ok($$select assert_can_manage_payouts('cccccc17-0000-0000-0000-000000000001')$$, '42501', null, 'a client member cannot manage payouts of another organization');

select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000003',true);
select lives_ok($$select assert_can_manage_payouts('cccccc17-0000-0000-0000-000000000001')$$, 'the provider owner can manage payouts');
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select throws_ok($$select assert_can_manage_payouts('cccccc17-0000-0000-0000-00000000000c')$$, '22023', null, 'a client company has no payout account');

reset role; set local role service_role;
select is((select payout_account('cccccc17-0000-0000-0000-000000000001')), 'acct_test_p', 'service role resolves an organization payout account');
select is((select payment_destination((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid)), 'acct_test_p', 'service role resolves the destination account');
select is((select attach_checkout_session((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_1', null)), true, 'service role attaches a checkout session');
select is((select record_payment_succeeded((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_1', 'pi_1', 39999, 'USD')), 'mismatch', 'a paid amount that differs from the expected total is refused');
select is((select status from payments where id = (current_setting('app.r1')::jsonb ->> 'payment_id')::uuid), 'pending', 'a mismatched payment stays pending');
select is((select record_payment_succeeded((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_1', 'pi_1', 40800, 'EUR')), 'mismatch', 'a different currency is refused');
select is((select record_payment_succeeded((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_1', 'pi_1', 40800, 'USD')), 'recorded', 'a matching payment is recorded');
select is((select status from milestones where id = '99999917-0000-0000-0000-000000000001'), 'paid', 'milestone becomes paid');
select is((select record_payment_succeeded((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_1', 'pi_1', 40800, 'USD')), 'duplicate', 'replaying the same payment changes nothing');
select is((select record_payment_succeeded((current_setting('app.r1')::jsonb ->> 'payment_id')::uuid, 'cs_test_2', 'pi_2', 40800, 'USD')), 'duplicate_charge', 'a second charge for a paid milestone is flagged');
select is((select count(*)::int from audit_log where action = 'payment.duplicate_charge'), 1, 'a duplicate charge is written to the audit log');
select is((select record_payment_succeeded('99999917-0000-0000-0000-000000000009','cs_x','pi_x',1,'USD')), 'unknown', 'an unknown payment id is acknowledged without effect');
select is((select status from contracts where id = 'dddddd17-0000-0000-0000-000000000001'), 'active', 'contract stays active while milestones remain unpaid');

-- failure then retry
select is((select attach_checkout_session((select id from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'cs_m2_old', null)), true, 'a session is attached to the second payment');
select is((select record_payment_failed((select id from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'cs_unrelated')), 'ignored', 'a failure event for some other session does not fail the payment');
select is((select status from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'pending', 'the payment is still pending after a stale event');
select is((select record_payment_failed((select id from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'cs_m2_old')), 'failed', 'a failed checkout is recorded');
select is((select status from milestones where id = '99999917-0000-0000-0000-000000000002'), 'approved', 'milestone stays approved after a failure');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select set_config('app.r2', (select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000002'))::text, true);
select is(current_setting('app.r2')::jsonb ->> 'payment_id', (select id::text from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'retry reuses the same payment row');
select is(current_setting('app.r2')::jsonb ->> 'previous_session', 'cs_m2_old', 'retry reports the old session so the server can expire it');
select is((select status from payments where milestone_id = '99999917-0000-0000-0000-000000000002'), 'pending', 'retry puts the payment back to pending');
select is((select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000002') ->> 'previous_session'), 'cs_m2_old', 'the old session stays on record until a new one is attached, so a second click still sees it');
reset role; set local role service_role;
select is((select attach_checkout_session((current_setting('app.r2')::jsonb ->> 'payment_id')::uuid, 'cs_m2_a', 'cs_m2_old')), true, 'the first click attaches its session');
select is((select attach_checkout_session((current_setting('app.r2')::jsonb ->> 'payment_id')::uuid, 'cs_m2_b', 'cs_m2_old')), false, 'a concurrent second click loses the compare-and-set');
select is((select record_payment_failed((current_setting('app.r2')::jsonb ->> 'payment_id')::uuid, 'cs_m2_old')), 'ignored', 'the expiry of the replaced session does not fail the new attempt');
-- an expiry event that lands between expiring the old session and attaching the new one is healed by the attach
select is((select record_payment_failed((current_setting('app.r2')::jsonb ->> 'payment_id')::uuid, 'cs_m2_a')), 'failed', 'an event for the current session fails the payment');
select is((select attach_checkout_session((current_setting('app.r2')::jsonb ->> 'payment_id')::uuid, 'cs_m2_c', 'cs_m2_a')), true, 'a fresh attach revives a payment failed by the stale event');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select throws_ok($$select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000001')$$, '22023', null, 'a paid milestone cannot be approved again');

-- completion
reset role;
update milestones set status = 'submitted' where id = '99999917-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000001',true);
select set_config('app.r3', (select approve_milestone('cccccc17-0000-0000-0000-00000000000c','99999917-0000-0000-0000-000000000003'))::text, true);
reset role; set local role service_role;
select is((select record_payment_succeeded((select id from payments where milestone_id = '99999917-0000-0000-0000-000000000002'),'cs_2','pi_2b',102,'USD')), 'recorded', 'second milestone paid');
select is((select record_payment_succeeded((current_setting('app.r3')::jsonb ->> 'payment_id')::uuid,'cs_3','pi_3',102,'USD')), 'recorded', 'last milestone paid');
select is((select status from contracts where id = 'dddddd17-0000-0000-0000-000000000001'), 'completed', 'paying the last milestone completes the contract');

reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa17-0000-0000-0000-000000000003',true);
select is((select count(*)::int from notifications where type = 'payment_received'), 3, 'the provider is told about each payment');
select is((select count(*)::int from notifications where type = 'contract_completed'), 1, 'the provider is told the contract completed');

select * from finish();
rollback;

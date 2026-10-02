begin;
select plan(9);
insert into auth.users (id, email) values ('aaaaaa21-0000-0000-0000-000000000001','client@x.test'),('aaaaaa21-0000-0000-0000-000000000003','prov@x.test');
insert into organizations (id, type, name) values
 ('cccccc21-0000-0000-0000-00000000000c','client_company','Client Co'),('cccccc21-0000-0000-0000-000000000001','individual','Provider One');
insert into memberships (user_id, org_id, role) values ('aaaaaa21-0000-0000-0000-000000000001','cccccc21-0000-0000-0000-00000000000c','owner'),('aaaaaa21-0000-0000-0000-000000000003','cccccc21-0000-0000-0000-000000000001','owner');
insert into projects (id, org_id, title, description, currency, status, visibility)
select ('eeeeee21-0000-0000-0000-00000000000' || g)::uuid, 'cccccc21-0000-0000-0000-00000000000c', 'Project ' || g, 'Detailed description', 'USD', 'closed', 'public' from generate_series(1,1) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff21-0000-0000-0000-000000000001','eeeeee21-0000-0000-0000-000000000001','cccccc21-0000-0000-0000-000000000001','Offer',60000,'USD',10,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('dddddd21-0000-0000-0000-000000000001','eeeeee21-0000-0000-0000-000000000001','ffffff21-0000-0000-0000-000000000001','cccccc21-0000-0000-0000-00000000000c','cccccc21-0000-0000-0000-000000000001','Contract 1',60000,'USD',500,200,'cancelled');
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999921-0000-0000-0000-000000000001','dddddd21-0000-0000-0000-000000000001',1,'M1',20000,'paid'),
 ('99999921-0000-0000-0000-000000000002','dddddd21-0000-0000-0000-000000000001',2,'M2',20000,'paid'),
 ('99999921-0000-0000-0000-000000000003','dddddd21-0000-0000-0000-000000000001',3,'M3',20000,'approved');
insert into payments (id, milestone_id, contract_id, payment_intent_id, checkout_session_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888821-0000-0000-0000-000000000001','99999921-0000-0000-0000-000000000001','dddddd21-0000-0000-0000-000000000001','pi_a','cs_a',20000,400,1000,20400,1400,'USD','refunded'),
 ('88888821-0000-0000-0000-000000000002','99999921-0000-0000-0000-000000000002','dddddd21-0000-0000-0000-000000000001','pi_b','cs_b',20000,400,1000,20400,1400,'USD','refund_pending'),
 ('88888821-0000-0000-0000-000000000003','99999921-0000-0000-0000-000000000003','dddddd21-0000-0000-0000-000000000001',null,'cs_c',20000,400,1000,20400,1400,'USD','pending');
set local role service_role;
select is((select record_payment_succeeded('88888821-0000-0000-0000-000000000001', 'cs_x', 'pi_x', 20400, 'USD')), 'duplicate_charge', 'a second charge for a refunded payment is flagged');
select is((select record_payment_succeeded('88888821-0000-0000-0000-000000000001', 'cs_a', 'pi_a', 20400, 'USD')), 'duplicate', 'a replay for a refunded payment changes nothing');
select is((select record_payment_succeeded('88888821-0000-0000-0000-000000000002', 'cs_y', 'pi_y', 20400, 'USD')), 'duplicate_charge', 'a second charge for a payment being refunded is flagged');
select is((select record_payment_succeeded('88888821-0000-0000-0000-000000000002', 'cs_b', 'pi_b', 20400, 'USD')), 'duplicate', 'a replay for a payment being refunded changes nothing');
reset role;
select is((select status || '/' || payment_intent_id from payments where id = '88888821-0000-0000-0000-000000000001'), 'refunded/pi_a', 'a refunded payment keeps its status and intent');
select is((select status || '/' || payment_intent_id from payments where id = '88888821-0000-0000-0000-000000000002'), 'refund_pending/pi_b', 'a payment being refunded keeps its intent, so the right charge is refunded');
set local role service_role;
select is((select record_payment_succeeded('88888821-0000-0000-0000-000000000003', 'cs_c', 'pi_c', 20400, 'USD')), 'paid_on_cancelled', 'money arriving on a cancelled contract is reported for a human');
reset role;
select is((select status from payments where id = '88888821-0000-0000-0000-000000000003'), 'succeeded', 'the charge is still recorded, because the money moved');
select is((select count(*)::int from audit_log where action = 'payment.on_cancelled_contract' and entity_id = '88888821-0000-0000-0000-000000000003'), 1, 'the late payment is audited');
select * from finish();
rollback;

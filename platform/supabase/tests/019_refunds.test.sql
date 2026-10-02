begin;
select plan(15);

insert into auth.users (id, email) values
 ('aaaaaa19-0000-0000-0000-000000000001','client@x.test'),
 ('aaaaaa19-0000-0000-0000-000000000003','prov@x.test'),
 ('aaaaaa19-0000-0000-0000-000000000006','stranger@x.test'),
 ('aaaaaa19-0000-0000-0000-000000000007','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc19-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc19-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc19-0000-0000-0000-000000000006','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa19-0000-0000-0000-000000000001','cccccc19-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa19-0000-0000-0000-000000000003','cccccc19-0000-0000-0000-000000000001','owner'),
 ('aaaaaa19-0000-0000-0000-000000000006','cccccc19-0000-0000-0000-000000000006','owner');
insert into platform_roles (user_id, role) values ('aaaaaa19-0000-0000-0000-000000000007','admin');
insert into projects (id, org_id, title, description, currency, status, visibility)
select ('eeeeee19-0000-0000-0000-00000000000' || g)::uuid, 'cccccc19-0000-0000-0000-00000000000c', 'Project ' || g, 'Detailed description', 'USD', 'closed', 'public' from generate_series(1,1) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff19-0000-0000-0000-000000000001','eeeeee19-0000-0000-0000-000000000001','cccccc19-0000-0000-0000-000000000001','Offer',40100,'USD',10,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('dddddd19-0000-0000-0000-000000000001','eeeeee19-0000-0000-0000-000000000001','ffffff19-0000-0000-0000-000000000001','cccccc19-0000-0000-0000-00000000000c','cccccc19-0000-0000-0000-000000000001','Contract 1',40100,'USD',500,200,'disputed');
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999919-0000-0000-0000-000000000001','dddddd19-0000-0000-0000-000000000001',1,'M1',20000,'paid'),
 ('99999919-0000-0000-0000-000000000002','dddddd19-0000-0000-0000-000000000001',2,'M2',20100,'paid');
insert into payments (id, milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888819-0000-0000-0000-000000000001','99999919-0000-0000-0000-000000000001','dddddd19-0000-0000-0000-000000000001',20000,400,1000,20400,1400,'USD','succeeded'),
 ('88888819-0000-0000-0000-000000000002','99999919-0000-0000-0000-000000000002','dddddd19-0000-0000-0000-000000000001',20100,402,1005,20502,1407,'USD','succeeded');

-- new payment statuses
select lives_ok($$update payments set status = 'refund_pending' where id = '88888819-0000-0000-0000-000000000001'$$, 'refund_pending is a payment status');
select lives_ok($$update payments set status = 'refunded' where id = '88888819-0000-0000-0000-000000000001'$$, 'refunded is a payment status');
select throws_ok($$update payments set status = 'bogus' where id = '88888819-0000-0000-0000-000000000001'$$, '23514', null, 'an unknown payment status is refused');
update payments set status = 'succeeded' where id = '88888819-0000-0000-0000-000000000001';

-- dispute resolution accepts the refund ruling
select lives_ok($$insert into disputes (id, contract_id, raised_by_org_id, reason, status, resolution) values ('77777719-0000-0000-0000-000000000001','dddddd19-0000-0000-0000-000000000001','cccccc19-0000-0000-0000-00000000000c','The work was never delivered','resolved','refund_cancel')$$, 'refund_cancel is a dispute resolution');
select throws_ok($$insert into disputes (contract_id, raised_by_org_id, reason, status, resolution) values ('dddddd19-0000-0000-0000-000000000001','cccccc19-0000-0000-0000-00000000000c','The work was never delivered','resolved','refund')$$, '23514', null, 'an unknown resolution is still refused');

-- refunds table shape
select lives_ok($$insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key) values ('88888819-0000-0000-0000-000000000001','77777719-0000-0000-0000-000000000001',20400,'USD','refund:88888819-0000-0000-0000-000000000001')$$, 'a refund row is created');
select is((select status from refunds limit 1), 'pending', 'a refund starts pending');
select throws_ok($$insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key) values ('88888819-0000-0000-0000-000000000001','77777719-0000-0000-0000-000000000001',20400,'USD','refund:other')$$, '23505', null, 'one refund per payment');
select throws_ok($$insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key) values ('88888819-0000-0000-0000-000000000002','77777719-0000-0000-0000-000000000001',20502,'USD','refund:88888819-0000-0000-0000-000000000001')$$, '23505', null, 'idempotency keys are unique');

-- access
set local role anon;
select throws_ok($$select * from refunds$$, '42501', null, 'anonymous cannot read refunds');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa19-0000-0000-0000-000000000001',true);
select throws_ok($$insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key) values ('88888819-0000-0000-0000-000000000002','77777719-0000-0000-0000-000000000001',1,'USD','k')$$, '42501', null, 'users cannot insert refunds');
select throws_ok($$update refunds set status = 'succeeded'$$, '42501', null, 'users cannot update refunds');
select is((select count(*)::int from refunds), 1, 'a contract party sees the refund');
select set_config('request.jwt.claim.sub','aaaaaa19-0000-0000-0000-000000000006',true);
select is((select count(*)::int from refunds), 0, 'a stranger sees nothing');
select set_config('request.jwt.claim.sub','aaaaaa19-0000-0000-0000-000000000007',true);
select is((select count(*)::int from refunds), 1, 'platform staff see the refund');

select * from finish();
rollback;

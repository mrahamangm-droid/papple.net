begin;
select plan(16);
insert into auth.users (id, email) values
 ('aaaaaa33-0000-0000-0000-0000000000a1','owner@x.test'),('aaaaaa33-0000-0000-0000-0000000000a2','viewer@x.test'),
 ('aaaaaa33-0000-0000-0000-0000000000a3','client@x.test'),('aaaaaa33-0000-0000-0000-0000000000a4','stranger@x.test');
insert into organizations (id, type, name) values
 ('cccccc33-0000-0000-0000-0000000000b1','individual','Prov'),('cccccc33-0000-0000-0000-0000000000c1','client_company','Cli');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa33-0000-0000-0000-0000000000a1','cccccc33-0000-0000-0000-0000000000b1','owner'),
 ('aaaaaa33-0000-0000-0000-0000000000a2','cccccc33-0000-0000-0000-0000000000b1','viewer'),
 ('aaaaaa33-0000-0000-0000-0000000000a3','cccccc33-0000-0000-0000-0000000000c1','owner');
insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee33-0000-0000-0000-000000000001','cccccc33-0000-0000-0000-0000000000c1','Project','Detailed description','AED','closed','public');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff33-0000-0000-0000-000000000001','eeeeee33-0000-0000-0000-000000000001','cccccc33-0000-0000-0000-0000000000b1','Offer',10503,'AED',10,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('dddddd33-0000-0000-0000-000000000001','eeeeee33-0000-0000-0000-000000000001','ffffff33-0000-0000-0000-000000000001','cccccc33-0000-0000-0000-0000000000c1','cccccc33-0000-0000-0000-0000000000b1','Work',10503,'AED',500,200,'active');
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999933-0000-0000-0000-000000000001','dddddd33-0000-0000-0000-000000000001',1,'Tiny',3,'paid'),
 ('99999933-0000-0000-0000-000000000002','dddddd33-0000-0000-0000-000000000001',2,'Big',10500,'paid');
insert into payments (id, milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888833-0000-0000-0000-000000000001','99999933-0000-0000-0000-000000000001','dddddd33-0000-0000-0000-000000000001',3,1,1,4,2,'AED','succeeded'),
 ('88888833-0000-0000-0000-000000000002','99999933-0000-0000-0000-000000000002','dddddd33-0000-0000-0000-000000000001',10500,210,525,10710,735,'AED','succeeded');
insert into disputes (id, contract_id, raised_by_org_id, reason, status, resolution) values ('77777733-0000-0000-0000-000000000001','dddddd33-0000-0000-0000-000000000001','cccccc33-0000-0000-0000-0000000000c1','The work was never delivered','resolved','cancel');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a1',true);
select save_billing_profile('cccccc33-0000-0000-0000-0000000000b1','Prov LLC','Office 1, Dubai','AE','TRN-9',10000);
select lives_ok($$select issue_invoice('cccccc33-0000-0000-0000-0000000000b1','99999933-0000-0000-0000-000000000001')$$, 'a tiny total at a 100% rate is invoiced');
select is((select net || '/' || tax || '/' || total from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'), '2/1/3', 'net plus tax equals the total at the extreme rate');

-- a payment that landed on a cancelled contract is not invoiced
reset role;
update contracts set status = 'cancelled' where id = 'dddddd33-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a1',true);
select throws_ok($$select issue_invoice('cccccc33-0000-0000-0000-0000000000b1','99999933-0000-0000-0000-000000000002')$$, '55000', null, 'no invoice for a payment on a cancelled contract');
reset role;
update contracts set status = 'active' where id = 'dddddd33-0000-0000-0000-000000000001';

-- a suspended provider cannot issue
update organizations set status = 'suspended' where id = 'cccccc33-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a1',true);
select throws_ok($$select issue_invoice('cccccc33-0000-0000-0000-0000000000b1','99999933-0000-0000-0000-000000000002')$$, '42501', null, 'a suspended organization cannot issue invoices');
reset role;
update organizations set status = 'active' where id = 'cccccc33-0000-0000-0000-0000000000b1';

-- credit notes: refund must have succeeded, only the provider side may issue, and issuing twice is idempotent
insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key, status) values ('88888833-0000-0000-0000-000000000001','77777733-0000-0000-0000-000000000001',4,'AED','refund:33-1','pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a1',true);
select throws_ok($$select issue_credit_note('cccccc33-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'))$$, '55000', null, 'a pending refund does not allow a credit note');
reset role;
update refunds set status = 'succeeded' where idempotency_key = 'refund:33-1';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a2',true);
select throws_ok($$select issue_credit_note('cccccc33-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'))$$, '42501', null, 'a viewer cannot issue a credit note');
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a3',true);
select throws_ok($$select issue_credit_note('cccccc33-0000-0000-0000-0000000000c1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'))$$, '42501', null, 'the client cannot issue a credit note');
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a4',true);
select throws_ok($$select issue_credit_note('cccccc33-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'))$$, '42501', null, 'a stranger cannot issue a credit note');
select set_config('request.jwt.claim.sub','aaaaaa33-0000-0000-0000-0000000000a1',true);
select lives_ok($$select issue_credit_note('cccccc33-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001'))$$, 'the provider owner issues the credit note');
select is((select issue_credit_note('cccccc33-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999933-0000-0000-0000-000000000001' and kind='invoice'))), (select id from invoices where kind='credit_note'), 'issuing the credit note twice returns the same one');
select is((select count(*)::int from invoices where kind='credit_note'), 1, 'still one credit note');

-- immutability holds for the service role and against truncate
reset role;
set local role service_role;
select throws_ok($$update invoices set total = 1$$, '42501', null, 'the service role cannot update an invoice');
select throws_ok($$delete from invoices$$, '42501', null, 'the service role cannot delete an invoice');
select throws_ok($$insert into invoices (org_id, contract_id, milestone_id, payment_id, kind, number, currency, net, tax_bps, tax, total, issuer, recipient, description) values ('cccccc33-0000-0000-0000-0000000000b1','dddddd33-0000-0000-0000-000000000001','99999933-0000-0000-0000-000000000002','88888833-0000-0000-0000-000000000002','invoice','FORGED','AED',1,0,0,1,'{}','{}','x')$$, '42501', null, 'the service role cannot forge an invoice');
select throws_ok($$update invoice_counters set last_no = 99$$, '42501', null, 'the service role cannot move the counter');
reset role;
select throws_ok($$truncate invoices cascade$$, 'P0001', null, 'truncate is blocked by trigger');
select * from finish();
rollback;

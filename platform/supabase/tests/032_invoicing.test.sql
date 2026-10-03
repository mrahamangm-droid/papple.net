begin;
select plan(27);
insert into auth.users (id, email) values
 ('aaaaaa32-0000-0000-0000-0000000000a1','prov-owner@x.test'),('aaaaaa32-0000-0000-0000-0000000000a2','prov-viewer@x.test'),
 ('aaaaaa32-0000-0000-0000-0000000000a3','client-owner@x.test'),('aaaaaa32-0000-0000-0000-0000000000a4','stranger@x.test'),
 ('aaaaaa32-0000-0000-0000-0000000000a5','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc32-0000-0000-0000-0000000000b1','individual','Provider Org'),('cccccc32-0000-0000-0000-0000000000c1','client_company','Client Org'),('cccccc32-0000-0000-0000-0000000000d1','agency','Stranger Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa32-0000-0000-0000-0000000000a1','cccccc32-0000-0000-0000-0000000000b1','owner'),
 ('aaaaaa32-0000-0000-0000-0000000000a2','cccccc32-0000-0000-0000-0000000000b1','viewer'),
 ('aaaaaa32-0000-0000-0000-0000000000a3','cccccc32-0000-0000-0000-0000000000c1','owner'),
 ('aaaaaa32-0000-0000-0000-0000000000a4','cccccc32-0000-0000-0000-0000000000d1','owner');
insert into platform_roles (user_id, role) values ('aaaaaa32-0000-0000-0000-0000000000a5','admin');
insert into projects (id, org_id, title, description, currency, status, visibility)
select ('eeeeee32-0000-0000-0000-00000000000' || g)::uuid, 'cccccc32-0000-0000-0000-0000000000c1', 'Project ' || g, 'Detailed description', 'AED', 'closed', 'public' from generate_series(1,1) g;
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff32-0000-0000-0000-000000000001','eeeeee32-0000-0000-0000-000000000001','cccccc32-0000-0000-0000-0000000000b1','Offer',30000,'AED',10,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('dddddd32-0000-0000-0000-000000000001','eeeeee32-0000-0000-0000-000000000001','ffffff32-0000-0000-0000-000000000001','cccccc32-0000-0000-0000-0000000000c1','cccccc32-0000-0000-0000-0000000000b1','Site survey',30000,'AED',500,200,'active');
insert into milestones (id, contract_id, position, title, amount, status) values
 ('99999932-0000-0000-0000-000000000001','dddddd32-0000-0000-0000-000000000001',1,'Survey',10500,'paid'),
 ('99999932-0000-0000-0000-000000000002','dddddd32-0000-0000-0000-000000000001',2,'Report',10000,'submitted'),
 ('99999932-0000-0000-0000-000000000003','dddddd32-0000-0000-0000-000000000001',3,'Handover',9500,'paid');
insert into payments (id, milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status) values
 ('88888832-0000-0000-0000-000000000001','99999932-0000-0000-0000-000000000001','dddddd32-0000-0000-0000-000000000001',10500,210,525,10710,735,'AED','succeeded'),
 ('88888832-0000-0000-0000-000000000003','99999932-0000-0000-0000-000000000003','dddddd32-0000-0000-0000-000000000001',9500,190,475,9690,665,'AED','succeeded');
\set P '''cccccc32-0000-0000-0000-0000000000b1'''
\set C '''cccccc32-0000-0000-0000-0000000000c1'''
\set M1 '''99999932-0000-0000-0000-000000000001'''

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa32-0000-0000-0000-0000000000a1',true);

-- billing profile
select throws_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000001')$$, '55000', null, 'no invoice without a billing profile');
select throws_ok($$select save_billing_profile('cccccc32-0000-0000-0000-0000000000b1','Provider LLC','Dubai','AE',null,500)$$, '22023', null, 'a tax rate needs a tax number');
select throws_ok($$select save_billing_profile('cccccc32-0000-0000-0000-0000000000b1','Provider LLC','Dubai','ae','TRN1',500)$$, '22023', null, 'country must be an ISO code');
select throws_ok($$select save_billing_profile('cccccc32-0000-0000-0000-0000000000b1','Provider LLC','Dubai','AE','TRN1',10001)$$, '22023', null, 'tax rate is capped at 100%');
select lives_ok($$select save_billing_profile('cccccc32-0000-0000-0000-0000000000b1','Provider LLC','Office 1, Dubai','AE','TRN-100',500)$$, 'the owner saves a billing profile');

-- issuing
select throws_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000002')$$, '55000', null, 'an unpaid milestone cannot be invoiced');
select lives_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000001')$$, 'a paid milestone is invoiced');
select is((select number from invoices where milestone_id = '99999932-0000-0000-0000-000000000001' and kind='invoice'), 'INV-' || extract(year from now())::int || '-000001', 'the first number is sequential and zero padded');
select is((select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000001')), (select id from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'), 'issuing twice returns the same invoice');
select is((select count(*)::int from invoices where org_id = 'cccccc32-0000-0000-0000-0000000000b1'), 1, 'still one invoice');
select is((select net || '/' || tax || '/' || total from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'), '10000/500/10500', 'tax-inclusive total splits into net and tax (500 bps)');
select is((select issuer ->> 'legal_name' from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'), 'Provider LLC', 'the issuer is snapshotted');
select is((select recipient ->> 'name' from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'), 'Client Org', 'the recipient falls back to the organization name');
select lives_ok($$select save_billing_profile('cccccc32-0000-0000-0000-0000000000b1','Renamed LLC','Elsewhere','AE','TRN-100',500)$$, 'the profile can change later');
select is((select issuer ->> 'legal_name' from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'), 'Provider LLC', 'an issued invoice does not change with the profile');
select lives_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000003')$$, 'a second paid milestone is invoiced');
select is((select number from invoices where milestone_id = '99999932-0000-0000-0000-000000000003'), 'INV-' || extract(year from now())::int || '-000002', 'the next invoice takes the next number');

-- credit notes
select throws_ok($$select issue_credit_note('cccccc32-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'))$$, '55000', null, 'no credit note without a refund');
reset role;
insert into disputes (id, contract_id, raised_by_org_id, reason, status, resolution) values ('77777732-0000-0000-0000-000000000001','dddddd32-0000-0000-0000-000000000001','cccccc32-0000-0000-0000-0000000000c1','The work was never delivered','resolved','cancel');
insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key, status) values ('88888832-0000-0000-0000-000000000001','77777732-0000-0000-0000-000000000001',10710,'AED','refund:32-1','succeeded');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa32-0000-0000-0000-0000000000a1',true);
select lives_ok($$select issue_credit_note('cccccc32-0000-0000-0000-0000000000b1',(select id from invoices where milestone_id = '99999932-0000-0000-0000-000000000001'))$$, 'a refunded payment gets a credit note');
select is((select count(*)::int from invoices where kind = 'credit_note'), 1, 'one credit note');
select is((select number from invoices where kind = 'credit_note'), 'CN-' || extract(year from now())::int || '-000003', 'credit notes share the gapless sequence');

-- access and immutability
select throws_ok($$update invoices set total = 1$$, '42501', null, 'invoices cannot be edited by users');
select set_config('request.jwt.claim.sub','aaaaaa32-0000-0000-0000-0000000000a2',true);
select throws_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000b1','99999932-0000-0000-0000-000000000003')$$, '42501', null, 'a viewer cannot issue invoices');
select set_config('request.jwt.claim.sub','aaaaaa32-0000-0000-0000-0000000000a3',true);
select is((select count(*)::int from invoices), 3, 'the client sees the invoices of its contract');
select throws_ok($$select issue_invoice('cccccc32-0000-0000-0000-0000000000c1','99999932-0000-0000-0000-000000000003')$$, '42501', null, 'the client cannot issue the provider invoice');
select set_config('request.jwt.claim.sub','aaaaaa32-0000-0000-0000-0000000000a4',true);
select is((select count(*)::int from invoices), 0, 'a stranger sees no invoices');
reset role;
select throws_ok($$update invoices set total = 1$$, 'P0001', null, 'even the service role cannot edit an invoice');
select * from finish();
rollback;

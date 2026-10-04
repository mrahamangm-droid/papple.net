begin;
select plan(30);

insert into auth.users (id, email) values
 ('aaaaaa10-0000-0000-0000-000000000001','client@x.test'),
 ('aaaaaa10-0000-0000-0000-000000000002','prov1@x.test'),
 ('aaaaaa10-0000-0000-0000-000000000003','prov2@x.test'),
 ('aaaaaa10-0000-0000-0000-000000000004','multi@x.test');
insert into organizations (id, type, name) values
 ('cccccc10-0000-0000-0000-00000000000c','client_company','Client Co'),
 ('cccccc10-0000-0000-0000-000000000001','individual','Provider One'),
 ('cccccc10-0000-0000-0000-000000000002','agency','Agency Two'),
 ('cccccc10-0000-0000-0000-000000000003','agency','Agency Three'),
 ('cccccc10-0000-0000-0000-00000000000d','client_company','Multi Client');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa10-0000-0000-0000-000000000001','cccccc10-0000-0000-0000-00000000000c','owner'),
 ('aaaaaa10-0000-0000-0000-000000000002','cccccc10-0000-0000-0000-000000000001','owner'),
 ('aaaaaa10-0000-0000-0000-000000000003','cccccc10-0000-0000-0000-000000000002','owner'),
 ('aaaaaa10-0000-0000-0000-000000000004','cccccc10-0000-0000-0000-00000000000d','owner'),
 ('aaaaaa10-0000-0000-0000-000000000004','cccccc10-0000-0000-0000-000000000003','owner');

insert into projects (id, org_id, title, description, currency, status, visibility) values
 ('eeeeee10-0000-0000-0000-000000000001','cccccc10-0000-0000-0000-00000000000c','Open project one','Detailed description','USD','open','public'),
 ('eeeeee10-0000-0000-0000-000000000002','cccccc10-0000-0000-0000-00000000000c','Draft project','Detailed description','USD','draft','members_only'),
 ('eeeeee10-0000-0000-0000-000000000003','cccccc10-0000-0000-0000-00000000000c','Closed project','Detailed description','USD','closed','public'),
 ('eeeeee10-0000-0000-0000-000000000004','cccccc10-0000-0000-0000-000000000002','Agency own project','Detailed description','USD','open','public'),
 ('eeeeee10-0000-0000-0000-000000000005','cccccc10-0000-0000-0000-00000000000c','Open project two','Detailed description','USD','open','public'),
 ('eeeeee10-0000-0000-0000-000000000006','cccccc10-0000-0000-0000-00000000000c','Open project three','Detailed description','USD','open','public'),
 ('eeeeee10-0000-0000-0000-000000000007','cccccc10-0000-0000-0000-00000000000c','Open project four','Detailed description','USD','open','public');

set local role anon;
select throws_ok($$select * from proposals$$, '42501', null, 'anon cannot read proposals');
reset role; set local role authenticated;

-- provider one submits
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000002',true);
select lives_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000001','I can deliver this.',250000,'USD',14)$$, 'provider submits a proposal');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','x',0,'USD',14)$$, '22023', null, 'price 0 refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','x',-5,'USD',14)$$, '22023', null, 'negative price refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','x',2147483648,'USD',14)$$, '22023', null, 'price above 2147483647 refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','   ',100,'USD',14)$$, '22023', null, 'blank cover letter refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005',repeat('a',5001),100,'USD',14)$$, '22023', null, 'cover letter over 5000 chars refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','x',100,'EUR',14)$$, '22023', null, 'currency must match the project');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000002','x',100,'USD',14)$$, '22023', null, 'draft project refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000003','x',100,'USD',14)$$, '22023', null, 'closed project refused');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000001','again',100,'USD',14)$$, '23505', null, 'second proposal for the same project refused');

-- own project, wrong org
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000003',true);
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000002','eeeeee10-0000-0000-0000-000000000004','mine',100,'USD',5)$$, '42501', null, 'cannot propose on own project');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000005','not mine',100,'USD',5)$$, '42501', null, 'cannot submit as an org you do not belong to');

-- visibility
select is((select count(*) from proposals)::int, 0, 'third org sees no proposals');
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000002',true);
select is((select count(*) from proposals)::int, 1, 'proposing org sees its proposal');
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000001',true);
select is((select count(*) from proposals)::int, 1, 'project client org sees the proposal');

-- client decisions
select lives_ok($$select set_proposal_status((select id from proposals limit 1),'shortlisted')$$, 'client shortlists');
select throws_ok($$select set_proposal_status((select id from proposals limit 1),'withdrawn')$$, '22023', null, 'client cannot set withdrawn');
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000002',true);
select throws_ok($$select set_proposal_status((select id from proposals limit 1),'declined')$$, '42501', null, 'provider cannot decide on its own proposal');

-- withdraw and a single resubmission
select throws_ok($$select withdraw_proposal('cccccc10-0000-0000-0000-000000000002',(select id from proposals limit 1))$$, '42501', null, 'wrong org cannot withdraw');
select lives_ok($$select withdraw_proposal('cccccc10-0000-0000-0000-000000000001',(select id from proposals limit 1))$$, 'provider withdraws');
select lives_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000001','Revised offer.',200000,'USD',10)$$, 'one resubmission after withdrawal is allowed');
select lives_ok($$select withdraw_proposal('cccccc10-0000-0000-0000-000000000001',(select id from proposals limit 1))$$, 'withdraw again');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000001','eeeeee10-0000-0000-0000-000000000001','Third try',100,'USD',10)$$, '23505', null, 'second resubmission refused');

-- monthly limit (placeholder default lowered to 2, then unlimited)
reset role;
update platform_settings set value='{"default":2}'::jsonb where key='limits.proposals_per_month';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000003',true);
select lives_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000002','eeeeee10-0000-0000-0000-000000000005','one',100,'USD',5), submit_proposal('cccccc10-0000-0000-0000-000000000002','eeeeee10-0000-0000-0000-000000000006','two',100,'USD',5)$$, 'two proposals within the monthly limit');
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000002','eeeeee10-0000-0000-0000-000000000007','three',100,'USD',5)$$, '54000', null, 'third proposal in the month refused');

-- two-org user must name the right org
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000004',true);
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-00000000000d','eeeeee10-0000-0000-0000-000000000001','as client',100,'USD',5)$$, '22023', null, 'client org cannot submit proposals even for a multi-org user');

-- race safety is a unique index
reset role;
select throws_ok($$insert into proposals (project_id, org_id, cover_letter, price, currency, delivery_days) values ('eeeeee10-0000-0000-0000-000000000001','cccccc10-0000-0000-0000-000000000001','dup',1,'USD',1)$$, '23505', null, 'unique index blocks concurrent duplicates');

-- a person who controls both the client org and an agency cannot bid on (and then shortlist) their own client's project
insert into auth.users (id, email) values ('aaaaaa10-0000-0000-0000-000000000005','both@x.test');
insert into organizations (id, type, name) values ('cccccc10-0000-0000-0000-000000000009','agency','Agency Nine');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa10-0000-0000-0000-000000000005','cccccc10-0000-0000-0000-00000000000c','member'),
 ('aaaaaa10-0000-0000-0000-000000000005','cccccc10-0000-0000-0000-000000000009','owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa10-0000-0000-0000-000000000005',true);
select throws_ok($$select submit_proposal('cccccc10-0000-0000-0000-000000000009','eeeeee10-0000-0000-0000-000000000001','self deal',1000,'USD',7)$$, '42501', null, 'user in both the client org and an agency cannot bid on that client''s project');
reset role;
select is((select count(*) from proposals where org_id = 'cccccc10-0000-0000-0000-000000000009')::int, 0, 'no proposal was created by the cross-org self-bid');

select * from finish();
rollback;

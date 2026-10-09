begin;
select plan(86);
insert into auth.users (id, email, email_confirmed_at) values
 ('aaaaaa40-0000-0000-0000-000000000001','u1@x.test', now()), -- client owner
 ('aaaaaa40-0000-0000-0000-000000000002','u2@x.test', now()), -- client admin
 ('aaaaaa40-0000-0000-0000-000000000003','u3@x.test', now()), -- client member
 ('aaaaaa40-0000-0000-0000-000000000004','u4@x.test', now()), -- client viewer
 ('aaaaaa40-0000-0000-0000-000000000005','u5@x.test', now()), -- provider owner
 ('aaaaaa40-0000-0000-0000-000000000006','u6@x.test', now()), -- provider member
 ('aaaaaa40-0000-0000-0000-000000000007','u7@x.test', now()); -- outsider owner
insert into organizations (id, type, name) values
 ('cccccc40-0000-0000-0000-000000000001','client_company','Client One'),
 ('cccccc40-0000-0000-0000-000000000005','individual','Provider One'),
 ('cccccc40-0000-0000-0000-000000000007','client_company','Outsider Org');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000001','owner'),
 ('aaaaaa40-0000-0000-0000-000000000002','cccccc40-0000-0000-0000-000000000001','admin'),
 ('aaaaaa40-0000-0000-0000-000000000003','cccccc40-0000-0000-0000-000000000001','member'),
 ('aaaaaa40-0000-0000-0000-000000000004','cccccc40-0000-0000-0000-000000000001','viewer'),
 ('aaaaaa40-0000-0000-0000-000000000005','cccccc40-0000-0000-0000-000000000005','owner'),
 ('aaaaaa40-0000-0000-0000-000000000006','cccccc40-0000-0000-0000-000000000005','member'),
 ('aaaaaa40-0000-0000-0000-000000000007','cccccc40-0000-0000-0000-000000000007','owner');
insert into projects (id, org_id, title, description, status) values
 ('eeeeee40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000001','Project one','A long enough description','open'),
 ('eeeeee40-0000-0000-0000-000000000002','cccccc40-0000-0000-0000-000000000001','Project two','A long enough description','open');
insert into proposals (id, project_id, org_id, cover_letter, price, currency, delivery_days, status) values
 ('ffffff40-0000-0000-0000-000000000001','eeeeee40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','Cover letter long enough',1000,'USD',7,'hired'),
 ('ffffff40-0000-0000-0000-000000000002','eeeeee40-0000-0000-0000-000000000002','cccccc40-0000-0000-0000-000000000005','Cover letter long enough',1000,'USD',7,'hired');
insert into contracts (id, project_id, proposal_id, client_org_id, provider_org_id, title, price, currency, commission_pro_bps, commission_client_bps, status) values
 ('99999940-0000-0000-0000-000000000001','eeeeee40-0000-0000-0000-000000000001','ffffff40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','Contract one',50000,'USD',500,200,'active'),
 ('99999940-0000-0000-0000-000000000002','eeeeee40-0000-0000-0000-000000000002','ffffff40-0000-0000-0000-000000000002','cccccc40-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','Contract two',50000,'USD',500,200,'cancelled');
insert into milestones (id, contract_id, position, title, amount) values
 ('88888840-0000-0000-0000-000000000001','99999940-0000-0000-0000-000000000001',1,'M one',1000),
 ('88888840-0000-0000-0000-000000000002','99999940-0000-0000-0000-000000000002',1,'M two',1000);
update platform_settings set value = '{"default":3}' where key = 'limits.tasks_per_contract';
update platform_settings set value = '{"default":2}' where key = 'limits.files_per_contract';
update platform_settings set value = '{"default":1}' where key = 'limits.storage_mb';

select is((select count(*)::int from platform_settings where key in ('limits.tasks_per_contract','limits.files_per_contract','limits.storage_mb')), 3, 'the migration inserts the three limits');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select throws_ok($$insert into tasks (contract_id, org_id, title) values ('99999940-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','Direct')$$, '42501', null, 'tasks cannot be written directly');
select throws_ok($$insert into time_entries (contract_id, org_id, user_id, work_date, minutes) values ('99999940-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','aaaaaa40-0000-0000-0000-000000000005', current_date, 10)$$, '42501', null, 'time entries cannot be written directly');
select throws_ok($$insert into contract_files (contract_id, org_id, name, mime, size_bytes, object_key, uploaded_by) values ('99999940-0000-0000-0000-000000000001','cccccc40-0000-0000-0000-000000000005','a.pdf','application/pdf',10,'orgs/x/y.pdf','aaaaaa40-0000-0000-0000-000000000005')$$, '42501', null, 'files cannot be written directly');

-- Tasks: provider side
select lives_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, '  Design logo  ', 'First draft', 'high', 'aaaaaa40-0000-0000-0000-000000000006', current_date + 3, '88888840-0000-0000-0000-000000000001', 'private')$$, 'a provider owner creates a private task');
select is((select title from tasks where title like 'Design%'), 'Design logo', 'the title is trimmed');
select is((select visibility from tasks where title = 'Design logo'), 'private', 'new tasks can be private');
select lives_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, 'Send drafts', '', 'normal', null, null, null, 'shared')$$, 'and a shared task');
select lives_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, 'Third task', '', 'low', null, null, null, 'private')$$, 'and a third task');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, 'Fourth task', '', 'low', null, null, null, 'private')$$, '54000', null, 'the per-contract task limit is enforced');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', gen_random_uuid(), 'Ghost', '', 'low', null, null, null, 'private')$$, '22023', null, 'editing a missing task is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Third task'), '', '', 'low', null, null, null, 'private')$$, '22023', null, 'an empty title is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Third task'), 'Third task', '', 'urgent', null, null, null, 'private')$$, '22023', null, 'an unknown priority is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Third task'), 'Third task', '', 'low', null, null, null, 'public')$$, '22023', null, 'an unknown visibility is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Third task'), 'Third task', '', 'low', null, null, '88888840-0000-0000-0000-000000000002', 'private')$$, '22023', null, 'a milestone of another contract is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Third task'), 'Third task', '', 'low', 'aaaaaa40-0000-0000-0000-000000000001', null, null, 'private')$$, '22023', null, 'an assignee outside the organization is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000007','99999940-0000-0000-0000-000000000001', null, 'Outsider', '', 'low', null, null, null, 'private')$$, '42501', null, 'an organization that is not a side of the contract cannot add tasks');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000001','99999940-0000-0000-0000-000000000001', null, 'Wrong org', '', 'low', null, null, null, 'private')$$, '42501', null, 'a user cannot act for an organization they do not belong to');
select lives_ok($$select task_set_status('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Design logo'), 'in_progress')$$, 'the owner moves a task along');
select throws_ok($$select task_set_status('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Design logo'), 'finished')$$, '22023', null, 'an unknown status is refused');
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000002', null, 'On cancelled', '', 'low', null, null, null, 'private')$$, '42501', null, 'tasks cannot be added to a cancelled contract');

-- Tasks: counterparty sees only shared ones, read-only
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from tasks), 1, 'the client sees only the shared task');
select is((select title from tasks), 'Send drafts', 'and it is the shared one');
select throws_ok($$select task_set_status('cccccc40-0000-0000-0000-000000000001', (select id from tasks where title = 'Send drafts'), 'done')$$, '22023', null, 'the client cannot change the provider''s shared task');
select throws_ok($$select task_set_status('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Send drafts'), 'done')$$, '42501', null, 'and cannot claim to be the provider');
select lives_ok($$select task_save('cccccc40-0000-0000-0000-000000000001','99999940-0000-0000-0000-000000000001', null, 'Send brand assets', '', 'normal', null, null, null, 'shared')$$, 'the client adds its own shared task');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000004',true);
select throws_ok($$select task_save('cccccc40-0000-0000-0000-000000000001','99999940-0000-0000-0000-000000000001', null, 'Viewer task', '', 'normal', null, null, null, 'private')$$, '42501', null, 'a viewer cannot write');
select is((select count(*)::int from tasks), 2, 'a viewer can read the shared tasks of both sides');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000007',true);
select is((select count(*)::int from tasks), 0, 'an outsider sees no tasks');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select is((select count(*)::int from tasks), 4, 'the provider sees its own three and the client''s shared task');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000006',true);
select throws_ok($$select task_delete('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Design logo'))$$, '42501', null, 'a member cannot delete a task someone else created');
select throws_ok($$select task_delete('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Send brand assets'))$$, '22023', null, 'and cannot delete the counterparty''s task');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select task_delete('cccccc40-0000-0000-0000-000000000005', (select id from tasks where title = 'Third task'))$$, 'an owner deletes a task');
select lives_ok($$select task_save('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Design logo'), 'Design logo v2', 'Changed', 'normal', null, null, null, 'shared')$$, 'an owner edits a task and shares it');
select is((select count(*)::int from tasks where visibility = 'shared'), 3, 'sharing is visible in the data');

-- Time entries: always private
select lives_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Design logo v2'), current_date, 90, 'Sketches')$$, 'time is logged against a task');
select lives_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, current_date, 30, '')$$, 'and without a task');
select throws_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, current_date, 0, '')$$, '22023', null, 'zero minutes is refused');
select throws_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', null, current_date, 1441, '')$$, '22023', null, 'more than a day is refused');
select throws_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001', (select id from tasks where title = 'Send brand assets'), current_date, 10, '')$$, '22023', null, 'time cannot be logged against the counterparty''s task');
select throws_ok($$select time_log('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000002', null, current_date, 10, '')$$, '42501', null, 'time cannot be logged on a cancelled contract');
select is((select sum(minutes)::int from time_entries), 120, 'the owner sees both entries');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from time_entries), 0, 'the client never sees the provider''s time');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000006',true);
select throws_ok($$select time_delete('cccccc40-0000-0000-0000-000000000005', (select id from time_entries where minutes = 90))$$, '42501', null, 'a member cannot delete a colleague''s time entry');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select time_delete('cccccc40-0000-0000-0000-000000000005', (select id from time_entries where minutes = 30))$$, 'the owner deletes a time entry');

-- Files
select lives_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000001','logo.pdf','application/pdf',500000,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000001.pdf','shared')$$, 'a file is registered as pending');
select is((select status from contract_files where id = 'dddddd40-0000-0000-0000-000000000001'), 'pending', 'it starts pending');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from contract_files), 0, 'a pending shared file is invisible to the counterparty');
select throws_ok($$select file_authorize('dddddd40-0000-0000-0000-000000000001')$$, '42501', null, 'and cannot be downloaded');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select throws_ok($$select file_confirm('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000001')$$, '42501', null, 'a file whose bytes the server has not verified cannot be confirmed');
select throws_ok($$select file_mark_verified('dddddd40-0000-0000-0000-000000000001', 500000)$$, '42501', null, 'a signed-in user cannot record a verification');
reset role;
select file_mark_verified('dddddd40-0000-0000-0000-000000000001', 500000);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select file_confirm('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000001')$$, 'the uploader confirms it');
select is((select status from contract_files where id = 'dddddd40-0000-0000-0000-000000000001'), 'ready', 'now ready');
select lives_ok($$select file_confirm('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000001')$$, 'confirming twice is harmless');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from contract_files), 1, 'the counterparty sees a ready shared file');
select is((select object_key from file_authorize('dddddd40-0000-0000-0000-000000000001')), 'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000001.pdf', 'and can get its download key through the RPC');
select throws_ok($$select object_key from contract_files$$, '42501', null, 'the object key is not selectable directly');
select throws_ok($$select file_delete('cccccc40-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000001')$$, '22023', null, 'the counterparty cannot delete it');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000002','big.pdf','application/pdf',2000000,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000002.pdf','private')$$, '54000', null, 'the storage limit counts pending and ready files');
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000002','x.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000001/dddddd40-0000-0000-0000-000000000002.pdf','private')$$, '22023', null, 'the key must belong to the writing organization');
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000002','x.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000009.pdf','private')$$, '22023', null, 'the key must carry the file id');
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000002','x.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000002.pdf','secret')$$, '22023', null, 'an unknown visibility is refused');
select lives_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000002','notes.pdf','application/pdf',100,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000002.pdf','private')$$, 'a small private file fits');
reset role;
select file_mark_verified('dddddd40-0000-0000-0000-000000000002', 100);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select file_confirm('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000002')$$, 'and is confirmed');
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000003','third.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000003.pdf','private')$$, '54000', null, 'the per-contract file limit is enforced');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from contract_files), 1, 'the counterparty never sees the private file');
select throws_ok($$select file_authorize('dddddd40-0000-0000-0000-000000000002')$$, '42501', null, 'nor can it download it');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000007',true);
select throws_ok($$select file_authorize('dddddd40-0000-0000-0000-000000000001')$$, '42501', null, 'an outsider cannot download a shared file');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select file_set_visibility('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000002','shared')$$, 'the owner shares a file');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select is((select count(*)::int from contract_files), 2, 'the counterparty now sees it');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select lives_ok($$select file_delete('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000002')$$, 'the owner deletes a file');
select lives_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000004','pend.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000004.pdf','private')$$, 'a pending file can be registered after the limits are tidied');
select is((select object_key from file_pending_key('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000004')), 'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000004.pdf', 'the uploader''s organization can read the key of a pending file');
select is((select size_bytes from file_pending_key('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000004')), 10::bigint, 'together with the declared size');
select throws_ok($$select file_pending_key('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000001')$$, '22023', null, 'but not of a file that is already ready');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select throws_ok($$select file_pending_key('cccccc40-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000004')$$, '22023', null, 'the counterparty cannot read a pending key');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);

-- Review fixes: an id cannot alias another feature's object, cancelled contracts cannot newly share files, the assignee is not exposed, tasks have their own share toggle.
reset role;
insert into provider_profiles (org_id, slug, headline) values ('cccccc40-0000-0000-0000-000000000005', 'work-files-provider', 'Work files provider');
insert into portfolio_items (profile_id, org_id, title, file_key)
  select id, org_id, 'Case study', 'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000009.pdf' from provider_profiles where slug = 'work-files-provider';
insert into contract_files (id, contract_id, org_id, name, mime, size_bytes, object_key, visibility, status, uploaded_by)
  values ('dddddd40-0000-0000-0000-000000000008','99999940-0000-0000-0000-000000000002','cccccc40-0000-0000-0000-000000000005','old.pdf','application/pdf',10,
          'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000008.pdf','private','ready','aaaaaa40-0000-0000-0000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select throws_ok($$select file_register('cccccc40-0000-0000-0000-000000000005','99999940-0000-0000-0000-000000000001','dddddd40-0000-0000-0000-000000000009','alias.pdf','application/pdf',10,'orgs/cccccc40-0000-0000-0000-000000000005/dddddd40-0000-0000-0000-000000000009.pdf','private')$$, '23505', null, 'a file cannot be registered under a key a portfolio item already uses');
select throws_ok($$select file_set_visibility('cccccc40-0000-0000-0000-000000000005','dddddd40-0000-0000-0000-000000000008','shared')$$, '42501', null, 'a file on a cancelled contract cannot be newly shared');
select throws_ok($$select assignee_id from tasks$$, '42501', null, 'the assignee column is not selectable');
select lives_ok($$select task_set_visibility('cccccc40-0000-0000-0000-000000000005',(select id from tasks where title = 'Send drafts'),'private')$$, 'the task owner unshares a task without resending its fields');
select is((select count(*)::int from tasks where title = 'Send drafts' and visibility = 'private'), 1, 'it is private now');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000003',true);
select throws_ok($$select task_set_visibility('cccccc40-0000-0000-0000-000000000001',(select id from tasks where title = 'Send drafts'),'shared')$$, '22023', null, 'the counterparty cannot change it');
select set_config('request.jwt.claim.sub','aaaaaa40-0000-0000-0000-000000000005',true);
select throws_ok($$select task_set_visibility('cccccc40-0000-0000-0000-000000000005',(select id from tasks where title = 'Send drafts'),'public')$$, '22023', null, 'an invalid visibility is refused');
select lives_ok($$select task_set_visibility('cccccc40-0000-0000-0000-000000000005',(select id from tasks where title = 'Send drafts'),'shared')$$, 'and it can be shared again');
reset role;
select is((select count(*)::int from audit_log where action in ('task.create','task.delete','file.register','file.delete','time.log')), 11, 'creates and deletes are audited');
select is((select count(*)::int from audit_log where action like 'file.%' and after::text like '%object_key%'), 0, 'audit rows do not carry object keys');
select * from finish();
rollback;

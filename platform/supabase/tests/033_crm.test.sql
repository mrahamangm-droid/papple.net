begin;
select plan(27);
insert into auth.users (id, email) values
 ('aaaaaa34-0000-0000-0000-0000000000a1','owner@x.test'),('aaaaaa34-0000-0000-0000-0000000000a2','member@x.test'),
 ('aaaaaa34-0000-0000-0000-0000000000a3','viewer@x.test'),('aaaaaa34-0000-0000-0000-0000000000a4','other@x.test'),
 ('aaaaaa34-0000-0000-0000-0000000000a5','admin@x.test');
insert into organizations (id, type, name) values
 ('cccccc34-0000-0000-0000-0000000000a1','individual','Org A'),('cccccc34-0000-0000-0000-0000000000b1','agency','Org B');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa34-0000-0000-0000-0000000000a1','cccccc34-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaa34-0000-0000-0000-0000000000a2','cccccc34-0000-0000-0000-0000000000a1','member'),
 ('aaaaaa34-0000-0000-0000-0000000000a3','cccccc34-0000-0000-0000-0000000000a1','viewer'),
 ('aaaaaa34-0000-0000-0000-0000000000a4','cccccc34-0000-0000-0000-0000000000b1','owner');
insert into platform_roles (user_id, role) values ('aaaaaa34-0000-0000-0000-0000000000a5','admin');
update platform_settings set value = '{"default":3}' where key = 'limits.crm_contacts';

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a2',true);

-- contacts
select lives_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Sara Khan', 'Khan Co', 'Sara@Khan.test', '+97150', 'manual')$$, 'a member creates a contact');
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Sara Again', null, 'sara@khan.test', null, 'manual')$$, '23505', null, 'the same email (any case) cannot be added twice');
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, '', null, null, null, 'manual')$$, '22023', null, 'a name is required');
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Bad Mail', null, 'not-an-email', null, 'manual')$$, '22023', null, 'an invalid email is refused');
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Odd Source', null, null, null, 'import')$$, '22023', null, 'users cannot claim the import source');
select lives_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'No Email', null, null, null, 'marketplace')$$, 'a contact without an email is fine');
select lives_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', (select id from crm_contacts where name = 'Sara Khan'), 'Sara K', 'Khan Co', 'sara@khan.test', null, 'manual')$$, 'a contact can be edited');
select is((select name from crm_contacts where lower(email) = 'sara@khan.test'), 'Sara K', 'the edit was saved');
select lives_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Third', null, 'third@x.test', null, 'manual')$$, 'a third contact fits the limit');
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Fourth', null, 'fourth@x.test', null, 'manual')$$, '54000', null, 'the plan limit stops a fourth contact');

-- import
select throws_ok($$select crm_import_contacts('cccccc34-0000-0000-0000-0000000000a1', '[{"name":"A","email":"a@x.test"}]'::jsonb, false)$$, '22023', null, 'import needs the attestation');
reset role;
update platform_settings set value = '{"default":5}' where key = 'limits.crm_contacts';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a2',true);
select is((select crm_import_contacts('cccccc34-0000-0000-0000-0000000000a1',
  '[{"name":"Imp One","email":"one@imp.test"},{"name":"Dup","email":"SARA@khan.test"},{"name":"","email":"x@imp.test"},{"name":"Imp Two","email":"two@imp.test"},{"name":"Imp Two Again","email":"two@imp.test"},{"name":"Over Limit","email":"over@imp.test"}]'::jsonb, true)::text),
  '{"limit": 1, "invalid": [3], "imported": 2, "duplicate": 2}', 'import reports imported, duplicate, invalid and over-limit rows');
select is((select count(*)::int from crm_contacts where source = 'import' and import_attested_at is not null), 2, 'imported contacts carry the attestation time');
select throws_ok($$select crm_import_contacts('cccccc34-0000-0000-0000-0000000000a1', (select jsonb_agg(jsonb_build_object('name','n'||g)) from generate_series(1,501) g), true)$$, '22023', null, 'more than 500 rows is refused');

-- deals and notes
select lives_ok($$select crm_save_deal('cccccc34-0000-0000-0000-0000000000a1', null, (select id from crm_contacts where name = 'Sara K'), 'Survey job', 'lead', 500000, 'AED', null)$$, 'a deal is created');
select throws_ok($$select crm_save_deal('cccccc34-0000-0000-0000-0000000000a1', null, (select id from crm_contacts where name = 'Sara K'), 'Bad stage', 'maybe', null, null, null)$$, '22023', null, 'an unknown stage is refused');
select lives_ok($$select crm_add_note('cccccc34-0000-0000-0000-0000000000a1', (select id from crm_contacts where name = 'Sara K'), 'Call next week', now() + interval '7 days')$$, 'a note with a follow-up is added');
select lives_ok($$select crm_complete_note('cccccc34-0000-0000-0000-0000000000a1', (select id from crm_notes limit 1))$$, 'a follow-up can be completed');
select ok((select done_at is not null from crm_notes limit 1), 'completion is recorded');

-- roles
select throws_ok($$select crm_delete_contact('cccccc34-0000-0000-0000-0000000000a1', (select id from crm_contacts where name = 'Third'))$$, '42501', null, 'a plain member cannot delete a contact');
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a3',true);
select throws_ok($$select crm_save_contact('cccccc34-0000-0000-0000-0000000000a1', null, 'Viewer Add', null, null, null, 'manual')$$, '42501', null, 'a viewer cannot write');
select ok((select count(*) from crm_contacts) > 0, 'a viewer can read');
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a1',true);
select lives_ok($$select crm_delete_contact('cccccc34-0000-0000-0000-0000000000a1', (select id from crm_contacts where name = 'Sara K'))$$, 'the owner deletes a contact');
select is((select count(*)::int from crm_deals) + (select count(*)::int from crm_notes), 0, 'its deals and notes go with it');

-- isolation
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a4',true);
select is((select count(*)::int from crm_contacts), 0, 'another organization sees nothing');
select throws_ok($$select crm_add_note('cccccc34-0000-0000-0000-0000000000b1', (select id from crm_contacts where org_id = 'cccccc34-0000-0000-0000-0000000000a1' limit 1), 'x', null)$$, '42501', null, 'a note cannot point at another organization''s contact');
select set_config('request.jwt.claim.sub','aaaaaa34-0000-0000-0000-0000000000a1',true);
select throws_ok($$insert into crm_contacts (org_id, name) values ('cccccc34-0000-0000-0000-0000000000a1','Direct')$$, '42501', null, 'there is no direct write path');
select * from finish();
rollback;

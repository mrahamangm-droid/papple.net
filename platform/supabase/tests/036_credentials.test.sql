begin;
select plan(72);
insert into auth.users (id, email) values
 ('aaaaaa36-0000-0000-0000-0000000000a1','owner@x.test'),('aaaaaa36-0000-0000-0000-0000000000a2','admin@x.test'),
 ('aaaaaa36-0000-0000-0000-0000000000a3','member@x.test'),('aaaaaa36-0000-0000-0000-0000000000a4','viewer@x.test'),
 ('aaaaaa36-0000-0000-0000-0000000000a5','stranger@x.test'),('aaaaaa36-0000-0000-0000-0000000000a6','support@x.test'),
 ('aaaaaa36-0000-0000-0000-0000000000a7','platform@x.test'),('aaaaaa36-0000-0000-0000-0000000000a8','ownerb@x.test');
insert into organizations (id, type, name) values
 ('cccccc36-0000-0000-0000-0000000000a1','individual','Expert A'),('cccccc36-0000-0000-0000-0000000000b1','individual','No Profile'),
 ('cccccc36-0000-0000-0000-0000000000c1','individual','Hidden Co'),('cccccc36-0000-0000-0000-0000000000d1','individual','Private Co');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa36-0000-0000-0000-0000000000a1','cccccc36-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaa36-0000-0000-0000-0000000000a2','cccccc36-0000-0000-0000-0000000000a1','admin'),
 ('aaaaaa36-0000-0000-0000-0000000000a3','cccccc36-0000-0000-0000-0000000000a1','member'),
 ('aaaaaa36-0000-0000-0000-0000000000a4','cccccc36-0000-0000-0000-0000000000a1','viewer'),
 ('aaaaaa36-0000-0000-0000-0000000000a8','cccccc36-0000-0000-0000-0000000000b1','owner');
insert into platform_roles (user_id, role) values ('aaaaaa36-0000-0000-0000-0000000000a6','support'),('aaaaaa36-0000-0000-0000-0000000000a7','admin');
insert into provider_profiles (org_id, slug, headline, status, visibility) values
 ('cccccc36-0000-0000-0000-0000000000a1','cred-a','Expert headline','active','public'),
 ('cccccc36-0000-0000-0000-0000000000c1','cred-c','Hidden headline','hidden_by_admin','public'),
 ('cccccc36-0000-0000-0000-0000000000d1','cred-d','Private headline','active','private');
insert into provider_credentials (profile_id, org_id, kind, title, issuer, status)
 select id, org_id, 'licence', 'Hidden Licence', 'Board', 'checked' from provider_profiles where slug = 'cred-c';
insert into provider_credentials (profile_id, org_id, kind, title, issuer, status)
 select id, org_id, 'licence', 'Private Licence', 'Board', 'checked' from provider_profiles where slug = 'cred-d';
create function extensions.t_edit_status(p_org uuid, p_id uuid, p_field text) returns text language plpgsql security definer set search_path = public as
$$ declare c provider_credentials%rowtype; begin
  update provider_credentials set status = 'checked' where id = p_id;
  select * into c from provider_credentials where id = p_id;
  perform credential_save(p_org, p_id, case p_field when 'kind' then 'certification' else c.kind end, c.title, c.issuer,
    case p_field when 'identifier' then 'CHANGED' else c.identifier end,
    case p_field when 'issued' then date '2019-05-05' else c.issued_on end,
    case p_field when 'expires' then date '2036-02-02' else c.expires_on end,
    case p_field when 'evidence' then 'https://example.com/other' else c.evidence_url end);
  return (select status from provider_credentials where id = p_id);
end $$;
grant execute on function extensions.t_edit_status(uuid, uuid, text) to authenticated;
insert into auth.users (id, email) values ('aaaaaa36-0000-0000-0000-0000000000a9','both@x.test');
insert into organizations (id, type, name) values ('cccccc36-0000-0000-0000-0000000000e1','individual','Staff Owned');
insert into memberships (user_id, org_id, role) values ('aaaaaa36-0000-0000-0000-0000000000a9','cccccc36-0000-0000-0000-0000000000e1','owner');
insert into platform_roles (user_id, role) values ('aaaaaa36-0000-0000-0000-0000000000a9','admin');
insert into provider_profiles (org_id, slug, headline) values ('cccccc36-0000-0000-0000-0000000000e1','cred-e','Staff headline');
insert into provider_credentials (id, profile_id, org_id, kind, title, issuer, identifier, status)
 select 'eeeeee36-0000-0000-0000-000000000001', id, org_id, 'licence', 'Own Licence', 'Board', 'X-1', 'pending' from provider_profiles where slug = 'cred-e';
select is((select count(*)::int from platform_settings where key = 'limits.credentials'), 1, 'the migration inserts the credential limit');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);

-- direct writes are closed
select throws_ok($$insert into provider_credentials (profile_id, org_id, kind, title, issuer) select id, org_id, 'degree', 'Direct', 'Uni' from provider_profiles where slug = 'cred-a'$$, '42501', null, 'credentials cannot be inserted directly');
select throws_ok($$update provider_credentials set status = 'checked'$$, '42501', null, 'status cannot be updated directly');
select throws_ok($$delete from provider_credentials$$, '42501', null, 'credentials cannot be deleted directly');

-- saving: validation
select lives_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'licence', 'PE Licence', 'Engineers Board', 'PE-123', '2020-01-01', '2035-01-01', 'https://example.com/pe')$$, 'an owner saves a credential');
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'wizard', 'Some Title', 'Issuer', null, null, null, null)$$, '22023', null, 'an unknown kind is refused');
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'No', 'Issuer', null, null, null, null)$$, '22023', null, 'a too short title is refused');
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'I', null, null, null, null)$$, '22023', null, 'a too short issuer is refused');
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'Issuer', null, null, null, 'http://example.com/x')$$, '22023', null, 'a non-https evidence link is refused');
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'Issuer', null, '2020-01-01', '2019-01-01', null)$$, '22023', null, 'expiry before issue is refused');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a8',true);
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000b1', null, 'degree', 'Some Title', 'Issuer', null, null, null, null)$$, '22023', null, 'an organization without a provider profile cannot add credentials');

-- who may save
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a3',true);
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'Issuer', null, null, null, null)$$, '42501', null, 'a member cannot add credentials');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a4',true);
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'Issuer', null, null, null, null)$$, '42501', null, 'a viewer cannot add credentials');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a5',true);
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'Some Title', 'Issuer', null, null, null, null)$$, '42501', null, 'a stranger cannot add credentials');
select is((select count(*)::int from provider_credentials), 0, 'a stranger reads nothing');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a3',true);
select is((select count(*)::int from provider_credentials), 0, 'a plain member reads nothing (identifier and evidence are private to owners and admins)');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a2',true);
select lives_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'degree', 'MSc Structures', 'Some University', null, '2015-06-01', null, null)$$, 'an admin adds a credential without evidence');

-- requesting a check
select throws_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my degree')$f$, (select id from provider_credentials where title = 'MSc Structures')), '22023', null, 'a check needs evidence (a link or an identifier)');
select throws_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'short')$f$, (select id from provider_credentials where title = 'PE Licence')), '22023', null, 'a short note is refused');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a3',true);
select throws_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my licence')$f$, (select id from provider_credentials where title = 'PE Licence')), '42501', null, 'a member cannot request a check');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select lives_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my licence')$f$, (select id from provider_credentials where title = 'PE Licence')), 'an owner requests a check');
select throws_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my licence again')$f$, (select id from provider_credentials where title = 'PE Licence')), '22023', null, 'only one pending check per credential');

-- editing resets trust
select lives_ok(format($f$select credential_save('cccccc36-0000-0000-0000-0000000000a1', %L, 'licence', 'PE Licence', 'Engineers Board of Dubai', 'PE-123', '2020-01-01', '2035-01-01', 'https://example.com/pe')$f$, (select id from provider_credentials where title = 'PE Licence')), 'an owner edits a pending credential');
select is((select status from provider_credentials where title = 'PE Licence'), 'declared', 'editing a pending credential returns it to self-declared');
select lives_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my licence')$f$, (select id from provider_credentials where title = 'PE Licence')), 'it can be requested again');

-- review: staff only, second factor, reason, audited
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a6',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select count(*)::int from provider_credentials), 5, 'support reads every credential');
select throws_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '42501', null, 'support cannot review');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '42501', null, 'an owner cannot approve their own credential');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a7',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '42501', null, 'an admin without a second factor cannot review');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok(format($f$select credential_review(%L, 'approved', 'short', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '22023', null, 'a review needs a reason');
select throws_ok(format($f$select credential_review(%L, 'maybe', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '22023', null, 'an unknown decision is refused');
select lives_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), 'an admin approves');
select is((select status from provider_credentials where title = 'PE Licence'), 'checked', 'the credential is now checked');
select throws_ok(format($f$select credential_review(%L, 'rejected', 'Changed my mind later', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), '22023', null, 'a credential that is not pending cannot be reviewed again');
reset role;
select is((select count(*)::int from notifications where user_id = 'aaaaaa36-0000-0000-0000-0000000000a1' and type = 'credential_checked'), 1, 'the organization is told');

-- a review is tied to the version the reviewer saw
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a7',true);
select throws_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', 999)$f$, (select id from provider_credentials where title = 'MSc Structures')), '22023', null, 'a review of a credential that is not pending is refused');
-- staff cannot review their own organization's credentials
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a9',true);
select throws_ok($$select credential_review('eeeeee36-0000-0000-0000-000000000001', 'approved', 'Looks genuine to me', 5)$$, '22023', null, 'a review made against an older version of the credential is refused');
select throws_ok($$select credential_review('eeeeee36-0000-0000-0000-000000000001', 'approved', 'Looks genuine to me', 1)$$, '42501', null, 'a platform admin cannot approve a credential of an organization they belong to');
select throws_ok($$select credential_revoke('eeeeee36-0000-0000-0000-000000000001', 'Some long enough reason')$$, '42501', null, 'nor revoke one');

-- every material field resets trust; an unchanged save does not
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'none'), 'checked', 'saving without changing anything keeps a checked credential checked');
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'kind'), 'declared', 'changing the type resets trust');
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'identifier'), 'declared', 'changing the identifier resets trust');
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'issued'), 'declared', 'changing the issue date resets trust');
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'expires'), 'declared', 'changing the expiry resets trust');
select is(extensions.t_edit_status('cccccc36-0000-0000-0000-0000000000a1', (select id from provider_credentials where title = 'PE Licence'), 'evidence'), 'declared', 'changing the evidence link resets trust');
reset role;
update provider_credentials set status = 'checked', kind = 'licence', identifier = 'PE-123', issued_on = '2020-01-01', expires_on = '2035-01-01', evidence_url = 'https://example.com/pe' where title = 'PE Licence';
set local role anon;

-- the public sees only what is safe
reset role;
set local role anon;
select is((select count(*)::int from public_provider_credentials where slug = 'cred-a'), 2, 'the public sees the checked credential and the self-declared one');
select is((select status from public_provider_credentials where title = 'MSc Structures'), 'declared', 'an unchecked credential is shown as self-declared');
select is((select status from public_provider_credentials where title = 'PE Licence'), 'checked', 'a checked credential is shown as checked');
select throws_ok($$select identifier from public_provider_credentials$$, '42703', null, 'the identifier is not in the public view');
select throws_ok($$select evidence_url from public_provider_credentials$$, '42703', null, 'nor the evidence link');
select is((select count(*)::int from public_provider_credentials where slug in ('cred-c','cred-d')), 0, 'hidden and private profiles show no credentials');
select throws_ok($$select * from provider_credentials$$, '42501', null, 'the table itself is not public');

-- expiry and editing a checked credential
reset role;
update provider_credentials set expires_on = current_date - 1 where title = 'PE Licence';
set local role anon;
select is((select status from public_provider_credentials where title = 'PE Licence'), 'expired', 'a checked credential past its expiry shows as expired');
reset role;
update provider_credentials set expires_on = date '2035-01-01' where title = 'PE Licence';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select lives_ok(format($f$select credential_save('cccccc36-0000-0000-0000-0000000000a1', %L, 'licence', 'PE Licence', 'A Different Board', 'PE-123', '2020-01-01', '2035-01-01', 'https://example.com/pe')$f$, (select id from provider_credentials where title = 'PE Licence')), 'an owner edits a checked credential');
select is((select status from provider_credentials where title = 'PE Licence'), 'declared', 'a checked credential cannot be swapped and stay checked');

-- reject, revoke
select lives_ok(format($f$select credential_save('cccccc36-0000-0000-0000-0000000000a1', %L, 'degree', 'MSc Structures', 'Some University', 'DEG-9', '2015-06-01', null, null)$f$, (select id from provider_credentials where title = 'MSc Structures')), 'evidence added to the degree');
select lives_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my degree')$f$, (select id from provider_credentials where title = 'MSc Structures')), 'a check is requested');
select lives_ok(format($f$select credential_request_check('cccccc36-0000-0000-0000-0000000000a1', %L, 'Please check my licence')$f$, (select id from provider_credentials where title = 'PE Licence')), 'and for the licence again');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a7',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok(format($f$select credential_review(%L, 'rejected', 'Could not confirm the degree', %s)$f$, (select id from provider_credentials where title = 'MSc Structures'), (select version from provider_credentials where title = 'MSc Structures')), 'an admin rejects');
select lives_ok(format($f$select credential_review(%L, 'approved', 'Looks genuine to me', %s)$f$, (select id from provider_credentials where title = 'PE Licence'), (select version from provider_credentials where title = 'PE Licence')), 'and approves the licence');
select throws_ok(format($f$select credential_revoke(%L, 'short')$f$, (select id from provider_credentials where title = 'PE Licence')), '22023', null, 'revoking needs a reason');
select lives_ok(format($f$select credential_revoke(%L, 'Licence was withdrawn by the issuer')$f$, (select id from provider_credentials where title = 'PE Licence')), 'an admin revokes a checked credential');
select throws_ok(format($f$select credential_revoke(%L, 'Licence was withdrawn by the issuer')$f$, (select id from provider_credentials where title = 'PE Licence')), '22023', null, 'only a checked credential can be revoked');
reset role;
set local role anon;
select is((select count(*)::int from public_provider_credentials where slug = 'cred-a'), 0, 'rejected and revoked credentials are not shown');
reset role;
select is((select count(*)::int from audit_log where action in ('credential.request','credential.review','credential.revoke')), 8, 'requests, reviews and revocations are audited');

-- a staff revocation is not undone by editing
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select lives_ok(format($f$select credential_save('cccccc36-0000-0000-0000-0000000000a1', %L, 'licence', 'PE Licence', 'A Different Board', 'PE-999', '2020-01-01', '2035-01-01', 'https://example.com/pe')$f$, (select id from provider_credentials where title = 'PE Licence')), 'an owner edits a revoked credential');
select is((select status from provider_credentials where title = 'PE Licence'), 'revoked', 'a revoked credential stays revoked');
reset role;
set local role anon;
select is((select count(*)::int from public_provider_credentials where slug = 'cred-a'), 0, 'and is still not shown');
reset role;

-- deleting and limits
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a3',true);
select throws_ok(format($f$select credential_delete('cccccc36-0000-0000-0000-0000000000a1', %L)$f$, (select id from provider_credentials where title = 'MSc Structures')), '42501', null, 'a member cannot delete');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a8',true);
select throws_ok(format($f$select credential_delete('cccccc36-0000-0000-0000-0000000000b1', %L)$f$, (select id from provider_credentials where title = 'MSc Structures')), '22023', null, 'a credential is only found through its own organization');
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select lives_ok(format($f$select credential_delete('cccccc36-0000-0000-0000-0000000000a1', %L)$f$, (select id from provider_credentials where title = 'MSc Structures')), 'an owner deletes');
reset role;
update platform_settings set value = '{"default":1}' where key = 'limits.credentials';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa36-0000-0000-0000-0000000000a1',true);
select throws_ok($$select credential_save('cccccc36-0000-0000-0000-0000000000a1', null, 'award', 'Some Award', 'Some Body', null, null, null, null)$$, '54000', null, 'the per-plan credential limit holds');

select * from finish();
rollback;

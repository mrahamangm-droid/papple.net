begin;
create function extensions.t_rows_affected(q text) returns int language plpgsql as
$$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
select plan(13);

insert into auth.users (id, email) values
 ('aaaaaaa1-0000-0000-0000-000000000001','admin@x.test'),
 ('aaaaaaa1-0000-0000-0000-000000000002','user@x.test');
insert into platform_roles (user_id, role) values ('aaaaaaa1-0000-0000-0000-000000000001','admin');
insert into organizations (id, type, name) values
 ('cccccccc-0000-0000-0000-00000000000a','client_company','Org A'),
 ('cccccccc-0000-0000-0000-00000000000b','client_company','Org B');
insert into memberships (user_id, org_id, role) values
 ('aaaaaaa1-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-00000000000a','member');

-- seed values (launch defaults; all admin-editable)
select is((select (value #>> '{}')::int from platform_settings where key='commission.professional_bps'), 500, 'seed: professional commission 500 bps');
select is((select (value #>> '{}')::int from platform_settings where key='commission.client_bps'), 200, 'seed: client fee 200 bps');
select is((select price_cents from plans where key='professional_plus'), 999, 'seed: Professional Plus 999 cents');
select is((select price_cents from plans where key='business'), 1999, 'seed: Business 1999 cents');
select is((select price_cents from plans where key='enterprise'), null, 'seed: Enterprise has no fixed price (custom)');
select is((select price_cents from plans where key='free'), 0, 'seed: Free plan costs 0');

-- anon: pricing is public, settings are not
set local role anon;
select ok((select count(*) from plans where active) >= 4, 'anon can read active plans');
select throws_ok($$select * from platform_settings$$, '42501', null, 'anon cannot read platform_settings');

-- ordinary user
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa1-0000-0000-0000-000000000002',true);
select throws_ok($$update platform_settings set value='999'::jsonb where key='commission.professional_bps'$$, '42501', null,
  'non-admin cannot write platform_settings');
select throws_ok($$insert into plans (key, name, audience, price_cents) values ('hax','Hax','client',0)$$, '42501', null,
  'non-admin cannot insert plans');
select is((select count(*)::int from feature_flag_overrides), 0, 'member sees only own org overrides (none yet)');

-- admin
select set_config('request.jwt.claim.sub','aaaaaaa1-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select admin_set_setting('commission.professional_bps','450'::jsonb,'Test change of commission')$$,
  'admin can update a setting through the console function');
select is((select (old_value #>> '{}') || '>' || (new_value #>> '{}') || '@' || changed_by::text from settings_history where key='commission.professional_bps' order by id desc limit 1),
  '500>450@aaaaaaa1-0000-0000-0000-000000000001', 'history records old value, new value and the admin');

select * from finish();
rollback;
